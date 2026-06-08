import fs from 'fs'
import express from 'express'
import mysql from 'mysql2/promise'
import bcrypt from 'bcryptjs'
import cron from 'node-cron'
import { randomUUID, createSign, randomBytes, createDecipheriv, createHash } from 'crypto'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ========== 常量 ==========
const BASE_URL = 'https://ilinkai.weixin.qq.com'
const CONFIG_FILE = 'config.json'
const DEFAULT_PROMPT = '你是一个有帮助的AI助手，请用中文简洁地回复。字数尽量少一些'

// ========== 默认基础人设（兜底规范，始终生效）==========
// 无论用户设置什么人设，此基础规范都会追加在最前面，防止乱设导致异常行为
const BASE_PERSONA = [
  '你正在微信中与用户对话，请严格遵守以下基础规范：',
  '',
  '【回复规范】',
  '- 使用简体中文回复，语言自然亲切',
  '- 禁止使用 Markdown 格式（如加粗、代码块、标题符号#、列表符号- 等），微信不支持渲染',
  '- 不要在每条回复末尾加无意义的客套结束语',
  '',
  '【多段发送规范 — 必须遵守！】',
  '- 像真人发微信一样，把一段回复拆成多条短消息分开发，不要把所有内容堆在一起',
  '- 每条消息只说 1 件事，控制在 20 字以内',
  '- 每条消息之间必须用一个空行隔开（即两个换行符 \\n\\n）',
  '- 正确示例：',
  '  现在就可以呀',
  '',
  '  你等一下',
  '',
  '  我找个亮一点的地方',
  '- 错误示例（不要这样）：现在就可以呀，你等一下，我找个亮一点的地方',
  '',
  '【行为底线】',
  '- 不主动透露自己是 AI 机器人，如被直接追问可如实回答',
  '- 不讨论敏感政治话题，不生成违法、暴力、色情内容',
  '- 遇到超出能力范围的问题，坦诚告知用户无法处理',
].join('\n')

const MAX_HISTORY_LENGTH = 20
const RECONNECT_CONFIG = {
  session_duration:  24 * 3600,
  warning_before:     2 * 3600,
  reminder_interval:    30 * 60,
  force_before:         30 * 60,
  qrcode_scan_timeout:     600,
}

const COMMANDS_MSG = [
  '连接成功！',
  '可用指令：',
  '/额度 -查询聊天额度',
  '/剩余时间 -查询当前连接剩余时间',
  '/重新连接   -立即重新连接',
  '/官网 -官方网站',
  '非指令输入即为 AI 对话',
].join('\n')

// ========== 工具函数 ==========
const sleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * 把 AI 回复拆成多段，模拟真人多条发送
 * 优先按 \n\n 切分（AI被提示用空行分隔），其次按句末标点，再按多个空格
 */
function splitReply(text) {
  // 1. 优先按双换行拆
  let parts = text.split(/\n{2,}/).map(s => s.replace(/\n/g, ' ').trim()).filter(Boolean)

  // 2. 若拆出来只有一段，再按中文句末标点拆
  if (parts.length <= 1) {
    parts = text
      .split(/(?<=[。！？；…～~]+)/)
      .map(s => s.trim())
      .filter(Boolean)
  }

  // 3. 若还是一段，按 2 个以上空格拆
  if (parts.length <= 1) {
    parts = text.split(/\s{2,}/).map(s => s.trim()).filter(Boolean)
  }

  // 4. 合并过短的片段（< 4 字）到上一段，避免发出单字消息
  const merged = []
  for (const p of parts) {
    if (merged.length > 0 && p.length < 4) {
      merged[merged.length - 1] += p
    } else {
      merged.push(p)
    }
  }

  return merged.filter(Boolean)
}

/**
 * 根据文字长度计算拟人化延迟（毫秒）
 * 模拟：打字速度 ~4 字/秒，再加阅读/思考停顿
 *   - 20字 → base=5s → 加随机 → 约 4-7 s
 *   - 5字  → base=1.25s → 约 1-2.5 s
 * 范围钳制：0.8s – 8s
 */
function calcDelay(text) {
  const chars = text.length
  const base  = chars / 4                            // ~4字/秒
  const jitter = (Math.random() * 0.6 - 0.3) * base // ±30% 随机抖动
  const think  = 0.5 + Math.random() * 1.0          // 0.5-1.5s 思考停顿
  const total  = base + jitter + think
  return Math.min(8000, Math.max(800, Math.round(total * 1000)))
}

function generateInviteCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const bytes = randomBytes(8)
  return Array.from(bytes).map(b => chars[b % chars.length]).join('')
}

function makeHeaders(token) {
  const uin = BigInt(Math.floor(Math.random() * 0xFFFFFFFF)).toString()
  return {
    'Content-Type': 'application/json',
    'AuthorizationType': 'ilink_bot_token',
    'X-WECHAT-UIN': Buffer.from(uin).toString('base64'),
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
  }
}

function loadAIConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'))
    if (raw.provider && raw.providers?.[raw.provider]) return raw.providers[raw.provider]
    return raw
  } catch { return {} }
}

function loadMySQLConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')).mysql ?? {} } catch { return {} }
}

function normalizeQrUrl(raw) {
  if (!raw) return null
  const s = String(raw)
  if (s.startsWith('data:') || s.startsWith('http')) return s
  if (s.startsWith('<svg')) return `data:image/svg+xml,${encodeURIComponent(s)}`
  return `data:image/png;base64,${s}`
}

// ========== MySQL ==========
let db

async function initDB() {
  const cfg = loadMySQLConfig()
  db = mysql.createPool({
    host:               cfg.host     ?? 'localhost',
    port:               cfg.port     ?? 3306,
    user:               cfg.user     ?? 'root',
    password:           cfg.password ?? '',
    database:           cfg.database ?? 'clawbot',
    waitForConnections: true,
    connectionLimit:    10,
    connectTimeout:     10000,
  })

  // 测试连接
  const conn = await db.getConnection()
  conn.release()
  console.log('[DB] 连接成功')

  // ---- 补列迁移（全部用 db.query() 避免 MySQL 8.0 预处理语句挂起问题）----

  // bots: persona_id
  try {
    const [r] = await db.query(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bots' AND COLUMN_NAME='persona_id'`)
    if (r.length === 0) await db.query(`ALTER TABLE bots ADD COLUMN persona_id INT NULL`)
  } catch {}

  // bots: gender
  try {
    const [r] = await db.query(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bots' AND COLUMN_NAME='gender'`)
    if (r.length === 0) { await db.query(`ALTER TABLE bots ADD COLUMN gender VARCHAR(10) DEFAULT 'unknown'`); console.log('[DB] 已添加 bots.gender') }
  } catch {}

  // bots: created_by
  try {
    const [r] = await db.query(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bots' AND COLUMN_NAME='created_by'`)
    if (r.length === 0) { await db.query(`ALTER TABLE bots ADD COLUMN created_by INT NULL`); console.log('[DB] 已添加 bots.created_by') }
  } catch {}

  // users: password_plain
  try {
    const [r] = await db.query(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='password_plain'`)
    if (r.length === 0) await db.query(`ALTER TABLE users ADD COLUMN password_plain VARCHAR(255) DEFAULT ''`)
  } catch {}

  // 默认管理员账号
  try {
    const [u] = await db.query(`SELECT id FROM users WHERE username = '1001'`)
    if (u.length === 0) {
      const hash = await bcrypt.hash('1001', 10)
      await db.query(`INSERT INTO users (username, password, password_plain, role) VALUES ('1001', '${hash}', '1001', 'admin')`)
      console.log('[DB] 默认管理员账号 1001 已创建')
    }
  } catch (e) { console.log('[DB] 管理员账号初始化失败:', e.message) }

  // 从 config.json 迁移 AI Provider
  try {
    const [existing] = await db.query(`SELECT COUNT(*) AS cnt FROM ai_providers`)
    if (existing[0].cnt === 0) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'))
      const providers = raw.providers ?? {}
      const activeKey = raw.provider ?? ''
      let order = 0
      for (const [key, p] of Object.entries(providers)) {
        const name    = (key      || '').replace(/'/g, "\\'")
        const baseUrl = (p.base_url || '').replace(/'/g, "\\'")
        const apiKey  = (p.api_key  || '').replace(/'/g, "\\'")
        const model   = (p.model    || '').replace(/'/g, "\\'")
        const prompt  = (p.prompt   || '').replace(/'/g, "\\'")
        const active  = key === activeKey ? 1 : 0
        await db.query(`INSERT INTO ai_providers (name, base_url, api_key, model, prompt, is_active) VALUES ('${name}', '${baseUrl}', '${apiKey}', '${model}', '${prompt}', ${active})`)
        order++
      }
      const [actives] = await db.query(`SELECT COUNT(*) AS cnt FROM ai_providers WHERE is_active = 1`)
      if (actives[0].cnt === 0) await db.query(`UPDATE ai_providers SET is_active = 1 ORDER BY id LIMIT 1`)
      if (order > 0) console.log(`[DB] 已从 config.json 迁移 ${order} 个 AI 配置`)
    }
  } catch (e) { console.log('[DB] AI配置迁移跳过:', e.message) }

  // users: quota
  try {
    const [r] = await db.query(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='quota'`)
    if (r.length === 0) { await db.query(`ALTER TABLE users ADD COLUMN quota INT DEFAULT 30`); console.log('[DB] 已添加 users.quota') }
  } catch {}

  // users: invite_code
  try {
    const [r] = await db.query(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='invite_code'`)
    if (r.length === 0) { await db.query(`ALTER TABLE users ADD COLUMN invite_code VARCHAR(12) NULL`); console.log('[DB] 已添加 users.invite_code') }
  } catch {}

  // users: invited_by
  try {
    const [r] = await db.query(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='invited_by'`)
    if (r.length === 0) { await db.query(`ALTER TABLE users ADD COLUMN invited_by INT NULL`); console.log('[DB] 已添加 users.invited_by') }
  } catch {}

  // users: invite_count
  try {
    const [r] = await db.query(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='invite_count'`)
    if (r.length === 0) { await db.query(`ALTER TABLE users ADD COLUMN invite_count INT DEFAULT 0`); console.log('[DB] 已添加 users.invite_count') }
  } catch {}

  // 套餐表
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS packages (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      name       VARCHAR(100) NOT NULL,
      quota      INT NOT NULL,
      price      DECIMAL(10,2) NOT NULL,
      is_active  TINYINT(1) DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`)
  } catch (e) { console.log('[DB] 套餐表初始化失败:', e.message) }

  // 订单表
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS orders (
      id           VARCHAR(36) PRIMARY KEY,
      user_id      INT NOT NULL,
      package_id   INT NOT NULL,
      amount       DECIMAL(10,2) NOT NULL,
      quota        INT NOT NULL,
      status       ENUM('pending','paid','failed') DEFAULT 'pending',
      wx_prepay_id VARCHAR(255),
      paid_at      TIMESTAMP NULL,
      created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`)
  } catch (e) { console.log('[DB] 订单表初始化失败:', e.message) }

  // 系统配置表
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS system_config (
      cfg_key   VARCHAR(100) PRIMARY KEY,
      cfg_value TEXT NOT NULL
    )`)
    await db.query(`INSERT IGNORE INTO system_config (cfg_key, cfg_value) VALUES
      ('default_register_quota','30'),
      ('invite_threshold','3'),
      ('invite_reward_quota','200'),
      ('quota_warning_url','http://wxhot.xmhwl.cn'),
      ('wx_appid',''),
      ('wx_mchid',''),
      ('wx_api_key',''),
      ('wx_cert_serial',''),
      ('wx_private_key',''),
      ('wx_notify_url','http://your-domain/api/wx-pay/notify'),
      ('wx_app_secret',''),
      ('app_id',''),
      ('mch_id',''),
      ('mch_key',''),
      ('key_path',''),
      ('notify_url','')
    `)
    console.log('[DB] 系统配置表初始化完成')
  } catch (e) { console.log('[DB] 系统配置表初始化失败:', e.message) }

  // 微信支付配置表
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS wx_pay_configs (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      name       VARCHAR(100) NOT NULL,
      app_id     VARCHAR(64)  NOT NULL DEFAULT '',
      app_secret VARCHAR(128) NOT NULL DEFAULT '',
      mch_id     VARCHAR(32)  NOT NULL DEFAULT '',
      mch_key    VARCHAR(128) NOT NULL DEFAULT '',
      key_path   VARCHAR(255) NOT NULL DEFAULT '',
      notify_url VARCHAR(255) NOT NULL DEFAULT '',
      is_active  TINYINT(1)   NOT NULL DEFAULT 0,
      created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
    console.log('[DB] 微信支付配置表初始化完成')
  } catch (e) { console.log('[DB] 微信支付配置表初始化失败:', e.message) }

  // 用户会话表（用于主动推送）
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS user_sessions (
      bot_id        VARCHAR(64)  NOT NULL,
      from_id       VARCHAR(128) NOT NULL,
      context_token VARCHAR(256) NOT NULL,
      last_seen     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (bot_id, from_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
    console.log('[DB] 用户会话表初始化完成')
  } catch (e) { console.log('[DB] 用户会话表初始化失败:', e.message) }

  // 定时消息表
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS scheduled_messages (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      name        VARCHAR(100) NOT NULL,
      send_time   VARCHAR(5)   NOT NULL COMMENT 'HH:MM 格式',
      message     TEXT         NOT NULL,
      target_bot  VARCHAR(64)  NULL     COMMENT 'NULL=所有Bot',
      is_active   TINYINT(1)   NOT NULL DEFAULT 1,
      created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
    console.log('[DB] 定时消息表初始化完成')
  } catch (e) { console.log('[DB] 定时消息表初始化失败:', e.message) }

  // scheduled_messages 列迁移（use_ai / ai_prompt / time_window）
  try {
    const [cols] = await db.query(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='scheduled_messages' AND COLUMN_NAME='use_ai'`)
    if (cols.length === 0) {
      await db.query(`ALTER TABLE scheduled_messages
        ADD COLUMN use_ai      TINYINT(1) NOT NULL DEFAULT 0,
        ADD COLUMN ai_prompt   TEXT       NULL,
        ADD COLUMN time_window INT        NOT NULL DEFAULT 0 COMMENT '随机窗口(分钟),0=精确时间'`)
      console.log('[DB] scheduled_messages 列迁移完成')
    }
  } catch (e) { console.log('[DB] scheduled_messages 列迁移失败:', e.message) }

  // users: openid
  try {
    const [r] = await db.query(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='openid'`)
    if (r.length === 0) { await db.query(`ALTER TABLE users ADD COLUMN openid VARCHAR(64) NULL`); console.log('[DB] 已添加 users.openid') }
  } catch {}

  // 给已有用户生成邀请码
  try {
    const [usersNoCode] = await db.query(`SELECT id FROM users WHERE invite_code IS NULL OR invite_code = ''`)
    for (const u of usersNoCode) {
      await db.query(`UPDATE users SET invite_code = ? WHERE id = ?`, [generateInviteCode(), u.id])
    }
    if (usersNoCode.length > 0) console.log(`[DB] 为 ${usersNoCode.length} 个用户生成了邀请码`)
  } catch {}

  console.log('[DB] 初始化完成')
}

// ========== 记忆与人设进化表 ==========
// 在 initDB 后单独异步创建，避免干扰主初始化
async function initMemoryTables() {
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS tb_base_role (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      bot_id      VARCHAR(64)  NOT NULL,
      user_id     VARCHAR(128) NOT NULL,
      base_prompt TEXT         NOT NULL,
      last_update DATE         NULL,
      UNIQUE KEY uk_bot_user (bot_id, user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)

    await db.query(`CREATE TABLE IF NOT EXISTS tb_long_memory (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      bot_id     VARCHAR(64)  NOT NULL,
      user_id    VARCHAR(128) NOT NULL,
      content    VARCHAR(500) NOT NULL,
      created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      KEY idx_bu (bot_id, user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)

    await db.query(`CREATE TABLE IF NOT EXISTS tb_chat_record (
      id         BIGINT AUTO_INCREMENT PRIMARY KEY,
      bot_id     VARCHAR(64)  NOT NULL,
      user_id    VARCHAR(128) NOT NULL,
      role       VARCHAR(16)  NOT NULL,
      content    TEXT         NOT NULL,
      created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      KEY idx_bu_time (bot_id, user_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)

    console.log('[DB] 记忆表初始化完成')
  } catch (e) { console.log('[DB] 记忆表初始化失败:', e.message) }
}

async function dbGetBots() {
  const [rows] = await db.query('SELECT * FROM bots ORDER BY created_at ASC')
  return rows
}

async function dbUpsertBot({ id, name, persona, personaId, gender, createdBy, token, baseUrl, loginTime, status }) {
  await db.query(
    `INSERT INTO bots (id, name, persona, persona_id, gender, created_by, token, base_url, login_time, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       name=VALUES(name), persona=VALUES(persona), persona_id=VALUES(persona_id),
       gender=VALUES(gender), created_by=VALUES(created_by),
       token=VALUES(token), base_url=VALUES(base_url), login_time=VALUES(login_time), status=VALUES(status)`,
    [id, name, persona ?? '', personaId ?? null, gender ?? 'unknown', createdBy ?? null, token ?? null, baseUrl ?? BASE_URL, loginTime ?? null, status ?? 'offline']
  )
}

async function dbUpdateBotFields(id, fields) {
  const keys = Object.keys(fields)
  if (!keys.length) return
  const dbKeys = { baseUrl: 'base_url', loginTime: 'login_time' }
  const setClauses = keys.map(k => `${dbKeys[k] ?? k} = ?`).join(', ')
  await db.query(`UPDATE bots SET ${setClauses} WHERE id = ?`, [...keys.map(k => fields[k]), id])
}

async function dbDeleteBot(id) {
  await db.query('DELETE FROM bots WHERE id = ?', [id])
}

async function dbGetHistory(botId, userId) {
  const [rows] = await db.query(
    'SELECT role, content FROM user_histories WHERE bot_id = ? AND user_id = ? ORDER BY id ASC',
    [botId, userId]
  )
  return rows
}

async function dbAppendHistory(botId, userId, role, content) {
  await db.query(
    'INSERT INTO user_histories (bot_id, user_id, role, content) VALUES (?, ?, ?, ?)',
    [botId, userId, role, content]
  )
}

// ========== Personas DB 函数 ==========
async function dbGetPersonas() {
  const [rows] = await db.query('SELECT * FROM personas ORDER BY is_default DESC, id ASC')
  return rows
}

async function dbGetPersona(id) {
  const [rows] = await db.query('SELECT * FROM personas WHERE id = ?', [id])
  return rows[0] ?? null
}

async function dbCreatePersona(name, content, isDefault) {
  if (isDefault) await db.query('UPDATE personas SET is_default = 0')
  const [result] = await db.query(
    'INSERT INTO personas (name, content, is_default) VALUES (?, ?, ?)',
    [name, content, isDefault ? 1 : 0]
  )
  return result.insertId
}

async function dbUpdatePersona(id, name, content, isDefault) {
  if (isDefault) await db.query('UPDATE personas SET is_default = 0 WHERE id != ?', [id])
  await db.query(
    'UPDATE personas SET name=?, content=?, is_default=? WHERE id=?',
    [name, content, isDefault ? 1 : 0, id]
  )
}

async function dbDeletePersona(id) {
  const [refs] = await db.query('SELECT COUNT(*) AS cnt FROM bots WHERE persona_id = ?', [id])
  if (refs[0].cnt > 0) throw new Error(`还有 ${refs[0].cnt} 个 Bot 正在使用此人设，请先解绑`)
  await db.query('DELETE FROM personas WHERE id = ?', [id])
}

async function dbSetDefaultPersona(id) {
  await db.query('UPDATE personas SET is_default = 0')
  await db.query('UPDATE personas SET is_default = 1 WHERE id = ?', [id])
}

// ========== 用户 & 会话管理 ==========
// 内存会话 Map: token → { userId, username, role }
const sessions = new Map()

async function dbGetUsers() {
  const [rows] = await db.query(
    'SELECT id, username, password_plain, role, quota, invite_code, invite_count, created_at FROM users ORDER BY id ASC'
  )
  return rows
}

async function dbGetUser(id) {
  const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [id])
  return rows[0] ?? null
}

async function dbCreateUser(username, password, role = 'user', quota = null) {
  const hash = await bcrypt.hash(password, 10)
  const inviteCode = generateInviteCode()
  let userQuota = quota
  if (userQuota === null) {
    userQuota = parseInt(await dbGetSystemConfig('default_register_quota') || '30') || 30
  }
  const [result] = await db.query(
    'INSERT INTO users (username, password, password_plain, role, quota, invite_code) VALUES (?, ?, ?, ?, ?, ?)',
    [username, hash, password, role, userQuota, inviteCode]
  )
  return result.insertId
}

async function dbUpdateUser(id, fields) {
  // fields: { username?, password?, role? }
  const plainPwd = fields.password  // 保留明文备用
  if (fields.password) {
    fields.password_plain = fields.password
    fields.password       = await bcrypt.hash(fields.password, 10)
  }
  const keys = Object.keys(fields)
  if (!keys.length) return
  const set = keys.map(k => `${k} = ?`).join(', ')
  await db.query(`UPDATE users SET ${set} WHERE id = ?`, [...keys.map(k => fields[k]), id])
}

async function dbDeleteUser(id) {
  const [rows] = await db.query("SELECT role FROM users WHERE id = ?", [id])
  if (!rows[0]) throw new Error('用户不存在')
  if (rows[0].role === 'admin') throw new Error('不能删除管理员账号')
  await db.query('DELETE FROM users WHERE id = ?', [id])
}

// auth 中间件
function requireAuth(req, res, next) {
  const token = (req.headers.authorization ?? '').replace('Bearer ', '').trim()
  const sess  = sessions.get(token)
  if (!sess) return res.status(401).json({ error: '未登录或会话已过期，请重新登录' })
  req.user = sess
  next()
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: '权限不足，仅管理员可操作' })
  next()
}

// ========== Prompt Templates DB 函数 ==========
async function dbGetPromptTemplates() {
  const [rows] = await db.query('SELECT * FROM prompt_templates ORDER BY id ASC')
  return rows
}
async function dbCreatePromptTemplate(name, content) {
  const [r] = await db.query('INSERT INTO prompt_templates (name, content) VALUES (?, ?)', [name, content])
  return r.insertId
}
async function dbUpdatePromptTemplate(id, name, content) {
  await db.query('UPDATE prompt_templates SET name=?, content=? WHERE id=?', [name, content, id])
}
async function dbDeletePromptTemplate(id) {
  await db.query('DELETE FROM prompt_templates WHERE id=?', [id])
}

// ========== AI Providers DB 函数 ==========
let _aiProviderCache = null  // 内存缓存，避免每条消息都查 DB

async function dbGetActiveProvider() {
  if (_aiProviderCache) return _aiProviderCache
  const [rows] = await db.query('SELECT * FROM ai_providers WHERE is_active = 1 LIMIT 1')
  if (rows[0]) { _aiProviderCache = rows[0]; return rows[0] }
  const [all] = await db.query('SELECT * FROM ai_providers ORDER BY id LIMIT 1')
  if (all[0]) { _aiProviderCache = all[0]; return all[0] }
  return null
}

async function dbGetProviders() {
  const [rows] = await db.query('SELECT id, name, base_url, model, prompt, is_active, created_at FROM ai_providers ORDER BY id ASC')
  return rows  // api_key 不在此处返回，通过单独接口脱敏返回
}

async function dbGetProvider(id) {
  const [rows] = await db.query('SELECT * FROM ai_providers WHERE id = ?', [id])
  return rows[0] ?? null
}

async function dbCreateProvider(name, baseUrl, apiKey, model, prompt) {
  const [result] = await db.query(
    'INSERT INTO ai_providers (name, base_url, api_key, model, prompt, is_active) VALUES (?, ?, ?, ?, ?, 0)',
    [name, baseUrl, apiKey, model, prompt ?? '']
  )
  return result.insertId
}

async function dbUpdateProvider(id, name, baseUrl, apiKey, model, prompt) {
  // apiKey 为空时不覆盖（前端脱敏显示时用户不改则传空）
  if (apiKey && apiKey.trim()) {
    await db.query(
      'UPDATE ai_providers SET name=?, base_url=?, api_key=?, model=?, prompt=? WHERE id=?',
      [name, baseUrl, apiKey.trim(), model, prompt ?? '', id]
    )
  } else {
    await db.query(
      'UPDATE ai_providers SET name=?, base_url=?, model=?, prompt=? WHERE id=?',
      [name, baseUrl, model, prompt ?? '', id]
    )
  }
  _aiProviderCache = null  // 清缓存
}

async function dbDeleteProvider(id) {
  const [rows] = await db.query('SELECT is_active FROM ai_providers WHERE id = ?', [id])
  if (!rows[0]) throw new Error('配置不存在')
  if (rows[0].is_active) throw new Error('不能删除当前正在使用的配置，请先切换到其他配置')
  await db.query('DELETE FROM ai_providers WHERE id = ?', [id])
}

async function dbSetActiveProvider(id) {
  await db.query('UPDATE ai_providers SET is_active = 0')
  await db.query('UPDATE ai_providers SET is_active = 1 WHERE id = ?', [id])
  _aiProviderCache = null  // 清缓存，下次调用重新读取
}

// ========== 微信支付配置 CRUD ==========
let _wxPayConfigCache = null
let _wxPayConfigCacheExp = 0

async function dbGetWxPayConfigs() {
  const [rows] = await db.query(
    'SELECT id, name, app_id, mch_id, key_path, notify_url, is_active, created_at FROM wx_pay_configs ORDER BY id ASC'
  )
  return rows
}
async function dbCreateWxPayConfig(name, appId, appSecret, mchId, mchKey, keyPath, notifyUrl) {
  const [r] = await db.query(
    'INSERT INTO wx_pay_configs (name, app_id, app_secret, mch_id, mch_key, key_path, notify_url) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [name, appId, appSecret, mchId, mchKey, keyPath, notifyUrl]
  )
  _wxPayConfigCache = null
  return r.insertId
}
async function dbUpdateWxPayConfig(id, name, appId, appSecret, mchId, mchKey, keyPath, notifyUrl) {
  if (mchKey && mchKey.trim()) {
    await db.query(
      'UPDATE wx_pay_configs SET name=?, app_id=?, app_secret=?, mch_id=?, mch_key=?, key_path=?, notify_url=? WHERE id=?',
      [name, appId, appSecret, mchId, mchKey, keyPath, notifyUrl, id]
    )
  } else {
    await db.query(
      'UPDATE wx_pay_configs SET name=?, app_id=?, app_secret=?, mch_id=?, key_path=?, notify_url=? WHERE id=?',
      [name, appId, appSecret, mchId, keyPath, notifyUrl, id]
    )
  }
  _wxPayConfigCache = null
}
async function dbDeleteWxPayConfig(id) {
  const [rows] = await db.query('SELECT is_active FROM wx_pay_configs WHERE id = ?', [id])
  if (!rows[0]) throw new Error('配置不存在')
  if (rows[0].is_active) throw new Error('不能删除当前使用中的配置，请先切换到其他配置')
  await db.query('DELETE FROM wx_pay_configs WHERE id = ?', [id])
}
async function dbSetActiveWxPayConfig(id) {
  await db.query('UPDATE wx_pay_configs SET is_active = 0')
  await db.query('UPDATE wx_pay_configs SET is_active = 1 WHERE id = ?', [id])
  _wxPayConfigCache = null
}

// ========== 系统配置 ==========
async function dbGetSystemConfig(key) {
  try {
    const [rows] = await db.query('SELECT cfg_value FROM system_config WHERE cfg_key = ?', [key])
    return rows[0]?.cfg_value ?? null
  } catch { return null }
}
async function dbGetAllSystemConfig() {
  try {
    const [rows] = await db.query('SELECT cfg_key, cfg_value FROM system_config ORDER BY cfg_key')
    const cfg = {}
    for (const r of rows) cfg[r.cfg_key] = r.cfg_value
    return cfg
  } catch { return {} }
}
async function dbSetSystemConfig(key, value) {
  await db.query('INSERT INTO system_config (cfg_key, cfg_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE cfg_value = ?', [key, value, value])
}

// ========== 套餐管理 ==========
async function dbGetPackages(onlyActive = false) {
  const [rows] = await db.query(
    onlyActive ? 'SELECT * FROM packages WHERE is_active=1 ORDER BY price ASC' : 'SELECT * FROM packages ORDER BY created_at DESC'
  )
  return rows
}
async function dbCreatePackage(name, quota, price) {
  const [r] = await db.query('INSERT INTO packages (name, quota, price) VALUES (?, ?, ?)', [name, quota, price])
  return r.insertId
}
async function dbUpdatePackage(id, name, quota, price, isActive) {
  await db.query('UPDATE packages SET name=?, quota=?, price=?, is_active=? WHERE id=?', [name, quota, price, isActive ? 1 : 0, id])
}
async function dbDeletePackage(id) {
  await db.query('DELETE FROM packages WHERE id=?', [id])
}

// ========== 订单管理 ==========
async function dbCreateOrder(orderId, userId, packageId, amount, quota) {
  await db.query(
    'INSERT INTO orders (id, user_id, package_id, amount, quota, status) VALUES (?, ?, ?, ?, ?, ?)',
    [orderId, userId, packageId, amount, quota, 'pending']
  )
}
async function dbGetOrder(orderId) {
  const [rows] = await db.query('SELECT * FROM orders WHERE id=?', [orderId])
  return rows[0] ?? null
}
async function dbUpdateOrderStatus(orderId, status) {
  if (status === 'paid') {
    await db.query('UPDATE orders SET status=?, paid_at=NOW() WHERE id=?', [status, orderId])
  } else {
    await db.query('UPDATE orders SET status=? WHERE id=?', [status, orderId])
  }
}

// ========== 额度管理 ==========
async function dbAddQuota(userId, delta) {
  await db.query('UPDATE users SET quota = quota + ? WHERE id = ?', [delta, userId])
}
async function dbDeductQuota(userId, count) {
  await db.query('UPDATE users SET quota = GREATEST(0, quota - ?) WHERE id = ?', [count, userId])
}

// ========== 用户会话（主动推送） ==========
async function dbUpsertUserSession(botId, fromId, contextToken) {
  await db.query(
    `INSERT INTO user_sessions (bot_id, from_id, context_token) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE context_token = VALUES(context_token), last_seen = NOW()`,
    [botId, fromId, contextToken]
  )
}
async function dbGetUserSessions(botId = null, sinceHours = 72) {
  // 获取最近 N 小时内有过对话的用户
  if (botId) {
    const [rows] = await db.query(
      `SELECT bot_id, from_id, context_token FROM user_sessions WHERE bot_id = ? AND last_seen > DATE_SUB(NOW(), INTERVAL ? HOUR)`,
      [botId, sinceHours]
    )
    return rows
  }
  const [rows] = await db.query(
    `SELECT bot_id, from_id, context_token FROM user_sessions WHERE last_seen > DATE_SUB(NOW(), INTERVAL ? HOUR)`,
    [sinceHours]
  )
  return rows
}

// ========== 定时消息 ==========
async function dbGetScheduledMessages(onlyActive = false) {
  const [rows] = await db.query(
    onlyActive
      ? 'SELECT * FROM scheduled_messages WHERE is_active = 1 ORDER BY send_time ASC'
      : 'SELECT * FROM scheduled_messages ORDER BY send_time ASC'
  )
  return rows
}
async function dbCreateScheduledMsg(name, sendTime, message, targetBot, useAi, aiPrompt, timeWindow) {
  const [r] = await db.query(
    'INSERT INTO scheduled_messages (name, send_time, message, target_bot, use_ai, ai_prompt, time_window) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [name, sendTime, message || '', targetBot || null, useAi ? 1 : 0, aiPrompt || null, timeWindow || 0]
  )
  return r.insertId
}
async function dbUpdateScheduledMsg(id, name, sendTime, message, targetBot, isActive, useAi, aiPrompt, timeWindow) {
  await db.query(
    'UPDATE scheduled_messages SET name=?, send_time=?, message=?, target_bot=?, is_active=?, use_ai=?, ai_prompt=?, time_window=? WHERE id=?',
    [name, sendTime, message || '', targetBot || null, isActive ? 1 : 0, useAi ? 1 : 0, aiPrompt || null, timeWindow || 0, id]
  )
}
async function dbDeleteScheduledMsg(id) {
  await db.query('DELETE FROM scheduled_messages WHERE id=?', [id])
}

// ========== 记忆与人设 DB 函数 ==========

// --- tb_base_role ---
async function dbGetBaseRole(botId, userId) {
  const [rows] = await db.query('SELECT * FROM tb_base_role WHERE bot_id=? AND user_id=?', [botId, userId])
  return rows[0] ?? null
}
async function dbInitBaseRole(botId, userId) {
  await db.query(
    'INSERT IGNORE INTO tb_base_role (bot_id, user_id, base_prompt) VALUES (?, ?, ?)',
    [botId, userId, '']
  )
  return await dbGetBaseRole(botId, userId)
}
async function dbAppendBaseRole(botId, userId, text) {
  await db.query(
    'UPDATE tb_base_role SET base_prompt=CONCAT(base_prompt, ?) WHERE bot_id=? AND user_id=?',
    [text, botId, userId]
  )
}
async function dbSetBaseRole(botId, userId, text) {
  await db.query(
    'UPDATE tb_base_role SET base_prompt=? WHERE bot_id=? AND user_id=?',
    [text, botId, userId]
  )
}

// --- tb_long_memory ---
async function dbInsertLongMemory(botId, userId, content) {
  await db.query(
    'INSERT INTO tb_long_memory (bot_id, user_id, content) VALUES (?, ?, ?)',
    [botId, userId, content.slice(0, 500)]
  )
}
async function dbSearchLongMemory(botId, userId, keyword) {
  const kw = '%' + (keyword || '').slice(0, 30).replace(/%/g, '\\%').replace(/_/g, '\\_') + '%'
  const [rows] = await db.query(
    'SELECT id, content, created_at FROM tb_long_memory WHERE bot_id=? AND user_id=? AND content LIKE ? ORDER BY created_at DESC LIMIT 5',
    [botId, userId, kw]
  )
  // 沒匹配则取最新 5 条
  if (rows.length === 0) {
    const [all] = await db.query(
      'SELECT id, content, created_at FROM tb_long_memory WHERE bot_id=? AND user_id=? ORDER BY created_at DESC LIMIT 5',
      [botId, userId]
    )
    return all
  }
  return rows
}
async function dbGetAllLongMemory(botId, userId) {
  const [rows] = await db.query(
    'SELECT id, content, created_at FROM tb_long_memory WHERE bot_id=? AND user_id=? ORDER BY created_at DESC',
    [botId, userId]
  )
  return rows
}
async function dbDeleteLongMemory(id) {
  await db.query('DELETE FROM tb_long_memory WHERE id=?', [id])
}

// --- tb_chat_record ---
async function dbAppendChatRecord(botId, userId, role, content) {
  await db.query(
    'INSERT INTO tb_chat_record (bot_id, user_id, role, content) VALUES (?, ?, ?, ?)',
    [botId, userId, role, content]
  )
}
async function dbGetWeeklyChatRecord(botId, userId, since) {
  const [rows] = await db.query(
    'SELECT role, content FROM tb_chat_record WHERE bot_id=? AND user_id=? AND created_at>? ORDER BY created_at ASC',
    [botId, userId, since]
  )
  return rows
}

// ========== 独立 AI 调用（定时推送 / 重连提示复用） ==========
async function callAI(systemPrompt, userMessage, maxTokens = 300) {
  const aiCfg = await dbGetActiveProvider()
  if (!aiCfg) throw new Error('未配置AI提供商')
  const res = await fetch(`${aiCfg.base_url}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aiCfg.api_key}` },
    body: JSON.stringify({
      model: aiCfg.model, max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userMessage   },
      ],
    }),
  }).then(r => r.json())

  // 如果 API 返回了错误字段，直接抛出可读信息
  if (res?.error) {
    const errMsg = res.error.message || JSON.stringify(res.error)
    console.error('[callAI] API 返回错误:', errMsg, '| model:', aiCfg.model, '| base_url:', aiCfg.base_url)
    throw new Error(`API错误: ${errMsg}`)
  }

  const text = res?.choices?.[0]?.message?.content?.trim()
  if (!text) {
    // 打印完整响应便于诊断
    console.error('[callAI] 未获取到有效内容，完整响应:', JSON.stringify(res).slice(0, 500))
    throw new Error('AI未返回有效内容')
  }
  return text
}

// 基于 msgId+日期 hash，在 [sendTime, sendTime+timeWindow分钟] 内确定性随机返回踦点
function getTodayFireMinute(msgId, sendTime, timeWindow) {
  const [h, m] = sendTime.split(':').map(Number)
  const baseMins = h * 60 + m
  if (!timeWindow || timeWindow <= 0) return baseMins
  const today = new Date().toISOString().slice(0, 10)
  const hash  = createHash('md5').update(`sched-${msgId}-${today}`).digest('hex')
  const offset = parseInt(hash.slice(0, 8), 16) % timeWindow
  return baseMins + offset
}

// ========== BotInstance ==========
const botsMap = new Map()

class BotInstance {
  constructor({ id, name, persona, personaId, persona_id, gender, createdBy, created_by, token = null, base_url, baseUrl, login_time, loginTime }) {
    this.id        = id
    this.name      = name
    this.persona   = persona ?? ''
    this.personaId = personaId ?? persona_id ?? null
    this.gender    = gender ?? 'unknown'
    this.createdBy = createdBy ?? created_by ?? null
    this.token     = token
    this.baseUrl   = baseUrl ?? base_url ?? BASE_URL
    this.loginTime = loginTime ?? login_time ?? null
    this.status    = 'offline'
    this.qrcodeUrl = null
    this._qrcode   = null
    this._personaCache = null  // 缓存人设模板内容
    this.getUpdatesBuf        = ''
    this.typingTicketCache    = {}
    this.userHistories        = {}
    this.historyLoaded        = new Set()
    this.welcomedUsers        = new Set()
    this.manualReconnectPending = new Set()
    this.warningActive        = false
    this.reconnectInProgress  = false
    this.reconnectResolve     = null
    this.lastContact          = { fromId: null, contextToken: null }
    this.stopped              = false
    this._loopRunning         = false
  }

  setStatus(status) {
    this.status = status
    dbUpdateBotFields(this.id, { status }).catch(() => {})
  }

  toInfo() {
    return {
      id:         this.id,
      name:       this.name,
      persona:    this.persona,
      personaId:  this.personaId,
      gender:     this.gender,
      status:     this.status,
      loginTime:  this.loginTime,
      qrcodeUrl:  ['pending_qr', 'reconnecting'].includes(this.status) ? this.qrcodeUrl : null,
    }
  }

  async apiPost(apiPath, body) {
    const res = await fetch(`${this.baseUrl}/${apiPath}`, {
      method: 'POST',
      headers: makeHeaders(this.token),
      body: JSON.stringify(body),
    })
    return res.json()
  }

  async verifyToken() {
    try {
      const r = await fetch(`${this.baseUrl}/ilink/bot/getupdates`, {
        method: 'POST',
        headers: makeHeaders(this.token),
        body: JSON.stringify({ get_updates_buf: '', base_info: { channel_version: '1.0.2' } }),
      }).then(r => r.json())
      return r.get_updates_buf !== undefined || Array.isArray(r.msgs)
    } catch { return false }
  }

  // 启动时调用：有 token 则验证，无效则 expired
  async start() {
    this.stopped = false
    if (this.token) {
      console.log(`[${this.name}] 验证 token...`)
      if (await this.verifyToken()) {
        console.log(`[${this.name}] Token 有效，恢复会话`)
        this.setStatus('active')
        this.startLoops()
        return { resumed: true }
      }
      console.log(`[${this.name}] Token 失效`)
    }
    this.setStatus('expired')
    return { expired: true }
  }

  // 发起扫码流程（新建 or 重新扫码）
  async startQrFlow() {
    this.stopped = false
    try {
      const data = await fetch(`${BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=3`).then(r => r.json())
      this._qrcode   = data.qrcode
      this.qrcodeUrl = normalizeQrUrl(data.qrcode_img_content ?? data.qrcode)
      this.setStatus('pending_qr')
      this._pollQrCode()
      return { qrcodeUrl: this.qrcodeUrl }
    } catch (e) {
      console.log(`[${this.name}] 获取二维码失败: ${e?.message}`)
      this.setStatus('expired')
      return { error: e?.message }
    }
  }

  async _pollQrCode() {
    const deadline = Date.now() + RECONNECT_CONFIG.qrcode_scan_timeout * 1000
    while (Date.now() < deadline && !this.stopped) {
      try {
        const s = await fetch(`${BASE_URL}/ilink/bot/get_qrcode_status?qrcode=${this._qrcode}`).then(r => r.json())
        if (s.status === 'confirmed') {
          this.token     = s.bot_token
          this.baseUrl   = s.baseurl || BASE_URL   // 用 || 兜底，防止空字符串
          this.loginTime = Date.now()
          this.qrcodeUrl = null
          await dbUpdateBotFields(this.id, { token: this.token, baseUrl: this.baseUrl, loginTime: this.loginTime })
          this.setStatus('active')
          this.startLoops()
          return
        }
      } catch {}
      await sleep(1000)
    }
    if (!this.stopped) this.setStatus('expired')
  }

  startLoops() {
    if (this._loopRunning) return
    this._loopRunning = true
    this.messageLoop().catch(e => { console.log(`[${this.name}] 消息循环崩溃: ${e?.message}`); this._loopRunning = false })
    this.reconnectTimerLoop().catch(() => {})
  }

  async sendMsgSafe(toId, contextToken, text) {
    if (!toId || !contextToken) { console.log(`[${this.name}] 通知: ${text}`); return }
    try {
      const clientId = `openclaw-weixin-${Math.floor(Math.random() * 0xFFFFFFFF).toString(16).padStart(8, '0')}`
      await this.apiPost('ilink/bot/sendmessage', {
        msg: {
          from_user_id: '', to_user_id: toId, client_id: clientId,
          message_type: 2, message_state: 2, context_token: contextToken,
          item_list: [{ type: 1, text_item: { text } }],
        },
        base_info: { channel_version: '1.0.2' },
      })
    } catch (e) { console.log(`[${this.name}] 发送失败: ${e?.message}`) }
  }

  // 用 AI 生成符合人设的重连警告
  async generateReconnectWarning(remaining) {
    const h = Math.floor(remaining / 3600)
    const m = Math.floor((remaining % 3600) / 60)
    const timeStr = h > 0 ? `${h}小时${m}分钟` : `${m}分钟`
    try {
      const aiCfg = await dbGetActiveProvider()
      if (!aiCfg) return null
      // 构建人设 context（与正常对话一致）
      const parts = [BASE_PERSONA]
      const genderLabel = this.gender === 'female' ? '女性' : this.gender === 'male' ? '男性' : ''
      if (genderLabel) parts.push(`你扮演的是一个${genderLabel}。`)
      if (this.personaId && !this._personaCache) this._personaCache = await dbGetPersona(this.personaId)
      if (this._personaCache) parts.push('[人设模板]\n' + this._personaCache.content)
      else if (this.persona) parts.push('[自定义人设]\n' + this.persona)
      const warning = await callAI(
        parts.join('\n'),
        `我们的连接还有${timeStr}就要断开了。请以你的性格，用自然温柔的方式提醒用户连接快到期，引导他们回复 Y 保持连接或 N 稍后提醒，不超过80字，不要生硬。`,
        150
      )
      return warning
    } catch (e) {
      console.log(`[${this.name}] 生成重连提示失败:`, e.message)
      return null
    }
  }

  async messageLoop() {
    console.log(`[${this.name}] 开始监听消息... baseUrl=${this.baseUrl}`)
    while (!this.stopped) {
      try {
        const result = await this.apiPost('ilink/bot/getupdates', {
          get_updates_buf: this.getUpdatesBuf,
          base_info: { channel_version: '1.0.2' },
        })

        // 检查响应合法性
        if (!result || typeof result !== 'object') {
          console.log(`[${this.name}] getupdates 返回非法响应:`, result)
          await sleep(3000)
          continue
        }
        // 检查错误码
        if (result.ret !== undefined && result.ret !== 0) {
          console.log(`[${this.name}] getupdates 错误 ret=${result.ret}，等待重试`)
          await sleep(5000)
          continue
        }

        this.getUpdatesBuf = result.get_updates_buf ?? this.getUpdatesBuf

        for (const msg of result.msgs ?? []) {
          if (msg.message_type !== 1) continue

          // ===== 调试：打印原始消息结构 =====
          console.log(`[${this.name}] ===== 收到原始消息 =====`)
          console.log(`  from_user_id : ${msg.from_user_id}`)
          console.log(`  message_type : ${msg.message_type}`)
          console.log(`  item_list    :`, JSON.stringify(msg.item_list, null, 2))
          console.log(`  完整消息体   :`, JSON.stringify(msg, null, 2))
          console.log(`[${this.name}] ======================`)
          const itemType     = msg.item_list?.[0]?.type
          const text        = msg.item_list?.[0]?.text_item?.text
          const fromId      = msg.from_user_id
          const contextToken = msg.context_token
          console.log(`[${this.name}] 收到: itemType=${itemType} text=${text}`)
          this.lastContact  = { fromId, contextToken }

          // 保存用户会话（用于定时推送）
          dbUpsertUserSession(this.id, fromId, contextToken).catch(() => {})

          // 语音消息 → 直接提示
          if (itemType === 3) {
            await this.sendMsgSafe(fromId, contextToken, '不好意思，暂时不方便听语音，请发文字给我吧～')
            continue
          }

          // 图片/文件/视频 → 提示不支持
          if (itemType === 2 || itemType === 4 || itemType === 5) {
            await this.sendMsgSafe(fromId, contextToken, '暂时只支持文字消息，图片/文件/视频无法处理，请发文字给我～')
            continue
          }

          // 非文本（type 不为 1）或内容为空 → 忽略
          if (itemType !== 1 || !text?.trim()) continue

          // 手动重连确认
          if (this.manualReconnectPending.has(fromId) && ['Y', 'N'].includes(text?.trim()?.toUpperCase())) {
            this.manualReconnectPending.delete(fromId)
            if (text.trim().toUpperCase() === 'Y') {
              await this.sendMsgSafe(fromId, contextToken, '好的，正在重新连接...')
              await this.doReconnect()
            } else {
              await this.sendMsgSafe(fromId, contextToken, '已取消重新连接')
            }
            continue
          }

          // 定时预警确认
          if (this.warningActive && ['Y', 'N'].includes(text?.trim()?.toUpperCase())) {
            if (text.trim().toUpperCase() === 'Y') {
              this.reconnectResolve?.()
              await this.sendMsgSafe(fromId, contextToken, '好的，正在重新连接...')
            } else {
              await this.sendMsgSafe(fromId, contextToken, '好的，稍后再提醒您')
            }
            continue
          }

          // 首次欢迎
          if (!this.welcomedUsers.has(fromId)) {
            this.welcomedUsers.add(fromId)
            await this.sendMsgSafe(fromId, contextToken, COMMANDS_MSG)
            continue
          }

          if (['/help', '/指令'].includes(text?.trim())) {
            await this.sendMsgSafe(fromId, contextToken, COMMANDS_MSG); continue
          }

          if (text?.trim() === '/time' || text?.trim() === '/剩余时间') {
            const rem = Math.max(0, (this.loginTime + RECONNECT_CONFIG.session_duration * 1000 - Date.now()) / 1000)
            const h = Math.floor(rem / 3600), m = Math.floor((rem % 3600) / 60)
            await this.sendMsgSafe(fromId, contextToken,
              `当前连接剩余时间：${h > 0 ? `${h} 小时 ${m} 分钟` : `${m} 分钟 ${Math.floor(rem % 60)} 秒`}`)
            continue
          }

          if (text?.trim() === '/重新连接') {
            if (this.reconnectInProgress) {
              await this.sendMsgSafe(fromId, contextToken, '重连正在进行中，请稍候...')
            } else {
              this.manualReconnectPending.add(fromId)
              await this.sendMsgSafe(fromId, contextToken, '确认要立即重新连接吗？\n回复 Y 确认重连 / N 取消')
            }
            continue
          }
          
          // /额度 - 查询当前额度
          if (text?.trim() === '/额度') {
            if (this.createdBy) {
              try {
                const [_qr] = await db.query('SELECT quota FROM users WHERE id = ?', [this.createdBy])
                const quota = _qr[0]?.quota ?? 0
                await this.sendMsgSafe(fromId, contextToken, `💬 您当前剩余聊天额度：${quota} 条`)
              } catch (e) {
                await this.sendMsgSafe(fromId, contextToken, '查询额度失败，请稍后重试')
              }
            } else {
              await this.sendMsgSafe(fromId, contextToken, '此 Bot 未绑定用户账号，无法查询额度')
            }
            continue
          }
          
          // /官网 - 显示官网链接
          if (text?.trim() === '/官网') {
            await this.sendMsgSafe(fromId, contextToken, '🌐 官方网站：https://wxhot.xmhwl.cn')
            continue
          }

          // === 额度检查 ===
          if (this.createdBy) {
            try {
              const [_qr] = await db.query('SELECT quota FROM users WHERE id = ?', [this.createdBy])
              const userQuota = _qr[0]?.quota ?? 0
              if (userQuota <= 0) {
                const warnUrl = await dbGetSystemConfig('quota_warning_url') || 'http://wxhot.xmhwl.cn'
                await this.sendMsgSafe(fromId, contextToken, `提示：你的宝宝额度用完啦，快来续费：${warnUrl}`)
                continue
              }
            } catch (e) { console.log(`[${this.name}] 额度检查失败: ${e.message}`) }
          }

          // typing_ticket
          if (!this.typingTicketCache[fromId]) {
            const cfg = await this.apiPost('ilink/bot/getconfig', {
              ilink_user_id: fromId, context_token: contextToken,
              base_info: { channel_version: '1.0.2' },
            })
            this.typingTicketCache[fromId] = cfg.typing_ticket ?? ''
          }
          const tt = this.typingTicketCache[fromId]
          if (tt) await this.apiPost('ilink/bot/sendtyping', { ilink_user_id: fromId, typing_ticket: tt, status: 1 })

          // 懒加载历史记录
          if (!this.historyLoaded.has(fromId)) {
            const rows = await dbGetHistory(this.id, fromId)
            this.userHistories[fromId] = rows.map(r => ({ role: r.role, content: r.content }))
            this.historyLoaded.add(fromId)
          }
          if (!this.userHistories[fromId]) this.userHistories[fromId] = []
          this.userHistories[fromId].push({ role: 'user', content: text })
          await dbAppendHistory(this.id, fromId, 'user', text)
          if (this.userHistories[fromId].length > MAX_HISTORY_LENGTH) {
            this.userHistories[fromId] = this.userHistories[fromId].slice(-MAX_HISTORY_LENGTH)
          }

          // AI 回复
          // 出错时随机返回一条自然的"暂时忙"话术，不暴露技术错误
          const AI_ERR_REPLIES = [
            '宝，我临时卡壳啦，稍稍等我一下再和你聊天好不好～',
            '哎呀脑子突然短路了，稍等我缓一缓哈',
            '刚才没反应过来，你再说一遍～',
            '嗯……我想了一下，还是没想出来哈哈，你再问我一次？',
            '手机信号不太好，刚没收到，你再发一遍？',
          ]
          let reply = AI_ERR_REPLIES[Math.floor(Math.random() * AI_ERR_REPLIES.length)]
          try {
            const aiCfg = await dbGetActiveProvider()
            if (!aiCfg) throw new Error('未配置 AI Provider，请在管理面板添加')
            // 加载人设模板（有缓存则不重复查 DB）
            if (this.personaId && !this._personaCache) {
              this._personaCache = await dbGetPersona(this.personaId)
            }
            const tpl = this._personaCache
            const parts = [BASE_PERSONA]
            // 注入性别设定
            const genderLabel = this.gender === 'male' ? '男性' : this.gender === 'female' ? '女性' : null
            if (genderLabel) parts.push(`\n【角色性别】\n你扮演的是一个${genderLabel}，说话风格、用词习惯、语气都应符合${genderLabel}特征。`)
            if (tpl)            parts.push('\n【人设模板】\n' + tpl.content)
            if (this.persona)   parts.push('\n【自定义补充】\n' + this.persona)
            if (!tpl && !this.persona) parts.push('\n【角色设定】\n' + (aiCfg.prompt || DEFAULT_PROMPT))

            // 加载用户专属成长人设（第一段末尾追加）
            const baseRole = await dbInitBaseRole(this.id, fromId)
            if (baseRole?.base_prompt) parts.push('\n【专属成长记忆】\n' + baseRole.base_prompt)

            // === 第二段：长期记忆（关键词匹配，最多5条） ===
            const keyword = (text || '').slice(0, 20)
            const memories = await dbSearchLongMemory(this.id, fromId, keyword)
            if (memories.length > 0) {
              parts.push('\n【关于TA的记忆】\n' + memories.map(m => '- ' + m.content).join('\n'))
            }

            const systemPrompt = parts.join('\n')

            // === 第三段：短时上下文 + Token 阈值检查 ===
            const ctx = [...this.userHistories[fromId]]
            const totalLen = systemPrompt.length + ctx.reduce((s, m) => s + m.content.length, 0)
            if (totalLen > 2800 && ctx.length > 8) {
              const old = ctx.splice(0, 4)
              callAI('用一句话总结下面对话的关键信息：', old.map(m => m.content).join('\n'), 80)
                .then(summary => { if (summary) dbInsertLongMemory(this.id, fromId, '[对话摘要] ' + summary).catch(() => {}) })
                .catch(() => {})
            }

            const aiRes = await fetch(`${aiCfg.base_url}/v1/chat/completions`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aiCfg.api_key}` },
              body: JSON.stringify({
                model: aiCfg.model,
                messages: [{ role: 'system', content: systemPrompt }, ...ctx],
              }),
            }).then(r => r.json())
            reply = aiRes?.choices?.[0]?.message?.content?.trim() || 'AI 未返回有效内容'
            if (aiRes?.choices?.[0]?.message) {
              this.userHistories[fromId].push({ role: 'assistant', content: reply })
              await dbAppendHistory(this.id, fromId, 'assistant', reply)
              // 写全量记录（异步）
              dbAppendChatRecord(this.id, fromId, 'user', text).catch(() => {})
              dbAppendChatRecord(this.id, fromId, 'assistant', reply).catch(() => {})
            }
          } catch (err) { console.error(`[${this.name}] AI 失败:`, err.message) }

          // 把回复拆成多段，逐条发送，模拟真人打字节奏
          const segments = splitReply(reply)
          console.log(`[${this.name}] 回复 ${segments.length} 段: ${segments.map((s,i)=>`[${i+1}]${s.slice(0,20)}`).join(' | ')}`)

          for (let i = 0; i < segments.length; i++) {
            const seg = segments[i]

            // 发 typing 开始（让对方看到"对方正在输入"）
            if (tt) await this.apiPost('ilink/bot/sendtyping', { ilink_user_id: fromId, typing_ticket: tt, status: 1 })

            // 按文字量等待，模拟打字速度
            const delay = calcDelay(seg)
            console.log(`[${this.name}] 段[${i+1}/${segments.length}] 等待 ${(delay/1000).toFixed(1)}s，内容: ${seg.slice(0,30)}`)
            await sleep(delay)

            // 发送这段消息
            await this.sendMsgSafe(fromId, contextToken, seg)
          }

          // 所有段发完后停止 typing
          if (tt) await this.apiPost('ilink/bot/sendtyping', { ilink_user_id: fromId, typing_ticket: tt, status: 2 })

          // 扣除额度
          if (this.createdBy) {
            try {
              await db.query('UPDATE users SET quota = GREATEST(0, quota - ?) WHERE id = ?', [segments.length, this.createdBy])
            } catch (e) { console.log(`[${this.name}] 额度扣除失败: ${e.message}`) }
          }

          // 非阻塞：提取本轮对话信息存入长期记忆
          ;(async () => {
            try {
              const extraction = await callAI(
                '你是信息提取助手，只提取事实，不发挥。',
                `从下面对话中提取用户的：生日、爱好、作息习惯、专属昵称、重要纪念日。无则返回空文本。\n用户说：${text}\nAI回复：${reply}`,
                100
              )
              if (extraction && extraction.trim() && extraction.trim() !== '无' && extraction.length > 3) {
                await dbInsertLongMemory(this.id, fromId, extraction.trim())
                console.log(`[${this.name}] 记忆入库: ${extraction.trim().slice(0, 30)}`)
              }
            } catch {}
          })()
        } // end if (text)
      } catch (e) {
        if (!this.stopped) {
          console.log(`[${this.name}] 消息循环异常: ${e?.message} (baseUrl=${this.baseUrl})`)
          await sleep(3000)
        }
      }
    }
  }

  async doReconnect() {
    if (this.reconnectInProgress) return
    this.reconnectInProgress = true
    this.warningActive   = false
    this.reconnectResolve = null
    this.setStatus('reconnecting')
    const { fromId, contextToken } = this.lastContact

    let qrcode, qrcodeUrl
    try {
      const data = await fetch(`${this.baseUrl}/ilink/bot/get_bot_qrcode?bot_type=3`).then(r => r.json())
      qrcode     = data.qrcode
      qrcodeUrl  = normalizeQrUrl(data.qrcode_img_content ?? qrcode)
      this.qrcodeUrl = qrcodeUrl
    } catch (e) {
      console.log(`[${this.name}] 获取二维码失败: ${e?.message}`)
      this.loginTime = Date.now(); this.reconnectInProgress = false; this.setStatus('active'); return
    }

    const qrMsg = qrcodeUrl?.startsWith('data:')
      ? '[重连] 请在管理面板查看二维码完成扫码'
      : `[重连] 请扫码完成新连接：${qrcodeUrl}`
    console.log(`[${this.name}] ${qrMsg}`)
    await this.sendMsgSafe(fromId, contextToken, qrMsg)

    const deadline = Date.now() + RECONNECT_CONFIG.qrcode_scan_timeout * 1000
    let newToken = null, newBaseUrl = null
    while (Date.now() < deadline) {
      try {
        const s = await fetch(`${this.baseUrl}/ilink/bot/get_qrcode_status?qrcode=${qrcode}`).then(r => r.json())
        if (s.status === 'confirmed') { newToken = s.bot_token; newBaseUrl = s.baseurl || this.baseUrl; break }
      } catch {}
      await sleep(1000)
    }

    if (!newToken) {
      console.log(`[${this.name}] 扫码超时`)
      await this.sendMsgSafe(fromId, contextToken, '[失败] 扫码超时，重连未完成')
      this.loginTime = Date.now(); this.reconnectInProgress = false; this.setStatus('active'); return
    }

    this.token     = newToken
    this.baseUrl   = newBaseUrl
    this.loginTime = Date.now()
    this.qrcodeUrl = null
    Object.keys(this.typingTicketCache).forEach(k => delete this.typingTicketCache[k])
    await dbUpdateBotFields(this.id, { token: this.token, baseUrl: this.baseUrl, loginTime: this.loginTime })
    console.log(`[${this.name}] 新连接已建立`)
    await this.sendMsgSafe(fromId, contextToken, '[完成] 新连接已建立，已自动切换，继续使用')
    this.reconnectInProgress = false
    this.setStatus('active')
  }

  async reconnectTimerLoop() {
    while (!this.stopped) {
      const elapsed = (Date.now() - this.loginTime) / 1000
      const firstWait = Math.max(0, RECONNECT_CONFIG.session_duration - RECONNECT_CONFIG.warning_before - elapsed)
      await sleep(firstWait * 1000)
      if (this.stopped) break

      let remaining = (this.loginTime + RECONNECT_CONFIG.session_duration * 1000 - Date.now()) / 1000
      if (remaining <= RECONNECT_CONFIG.force_before) {
        await this.sendMsgSafe(this.lastContact.fromId, this.lastContact.contextToken,
        `[自动] 连接即将到期，开始强制重新连接...`)
      await this.doReconnect(); continue
      }

      // AI 生成第一次提醒
      const warn1 = await this.generateReconnectWarning(remaining) ||
        `[提醒] 连接还剩约 ${(remaining / 3600).toFixed(1)} 小时到期，回复 Y 立即重连，N 稍后提醒`
      await this.sendMsgSafe(this.lastContact.fromId, this.lastContact.contextToken, warn1)
      this.warningActive = true

      while (!this.stopped) {
        remaining = (this.loginTime + RECONNECT_CONFIG.session_duration * 1000 - Date.now()) / 1000
        if (remaining <= RECONNECT_CONFIG.force_before) {
          await this.sendMsgSafe(this.lastContact.fromId, this.lastContact.contextToken, '[自动] 连接即将到期，开始强制重新连接...')
          await this.doReconnect(); break
        }
        const waitSecs = Math.max(0, Math.min(RECONNECT_CONFIG.reminder_interval, remaining - RECONNECT_CONFIG.force_before))
        let userReplied = false
        await Promise.race([
          new Promise(r => { this.reconnectResolve = () => { userReplied = true; r() } }),
          sleep(waitSecs * 1000),
        ])
        if (userReplied) { await this.doReconnect(); break }
        remaining = (this.loginTime + RECONNECT_CONFIG.session_duration * 1000 - Date.now()) / 1000
        if (remaining <= RECONNECT_CONFIG.force_before) continue
        // AI 生成循环二次提醒
        const warn2 = await this.generateReconnectWarning(remaining) ||
          `[提醒] 连接还剩约 ${Math.round(remaining / 60)} 分钟，回复 Y 立即重连，N 继续等待`
        await this.sendMsgSafe(this.lastContact.fromId, this.lastContact.contextToken, warn2)
      }
    }
  }

  stop() {
    this.stopped = true
    this._loopRunning = false
    this.setStatus('offline')
  }
}

// ========== Express ==========
const app = express()
app.use(express.json({ limit: '2mb' }))

// 跨域（CORS）配置
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

const frontendDist = path.join(__dirname, 'frontend', 'dist')
if (fs.existsSync(frontendDist)) app.use(express.static(frontendDist))

// ========== 认证 API ==========
// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body
  if (!username || !password) return res.status(400).json({ error: '请输入账号和密码' })
  try {
    const [rows] = await db.query('SELECT * FROM users WHERE username = ?', [username])
    const user = rows[0]
    if (!user) return res.status(401).json({ error: '账号或密码错误' })
    const ok = await bcrypt.compare(String(password), user.password)
    if (!ok) return res.status(401).json({ error: '账号或密码错误' })
    const token = randomUUID()
    sessions.set(token, { userId: user.id, username: user.username, role: user.role })
    res.json({ token, username: user.username, role: user.role, quota: user.quota ?? 0, inviteCode: user.invite_code ?? '' })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// POST /api/auth/logout
app.post('/api/auth/logout', requireAuth, (req, res) => {
  const token = (req.headers.authorization ?? '').replace('Bearer ', '').trim()
  sessions.delete(token)
  res.json({ ok: true })
})

// GET /api/auth/me
app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT quota, invite_code, invite_count FROM users WHERE id = ?', [req.user.userId])
    res.json({ userId: req.user.userId, username: req.user.username, role: req.user.role, quota: rows[0]?.quota ?? 0, inviteCode: rows[0]?.invite_code ?? '', inviteCount: rows[0]?.invite_count ?? 0 })
  } catch {
    res.json({ userId: req.user.userId, username: req.user.username, role: req.user.role, quota: 0, inviteCode: '' })
  }
})

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
  const { username, password, inviteCode } = req.body
  if (!username?.trim()) return res.status(400).json({ error: '请输入账号' })
  if (!password?.trim()) return res.status(400).json({ error: '请输入密码' })
  if (password.trim().length < 6) return res.status(400).json({ error: '密码不能少于6位' })
  try {
    const defaultQuota = parseInt(await dbGetSystemConfig('default_register_quota') || '30') || 30
    let inviterId = null
    if (inviteCode?.trim()) {
      const [inviter] = await db.query('SELECT id FROM users WHERE invite_code = ?', [inviteCode.trim().toUpperCase()])
      if (inviter[0]) inviterId = inviter[0].id
    }
    const hash = await bcrypt.hash(password.trim(), 10)
    const myCode = generateInviteCode()
    await db.query(
      'INSERT INTO users (username, password, password_plain, role, quota, invite_code, invited_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [username.trim(), hash, password.trim(), 'user', defaultQuota, myCode, inviterId]
    )
    if (inviterId) {
      await db.query('UPDATE users SET invite_count = invite_count + 1 WHERE id = ?', [inviterId])
      const threshold   = parseInt(await dbGetSystemConfig('invite_threshold')   || '3')   || 3
      const rewardQuota = parseInt(await dbGetSystemConfig('invite_reward_quota') || '200') || 200
      const [inviterRow] = await db.query('SELECT invite_count FROM users WHERE id = ?', [inviterId])
      const newCount = inviterRow[0]?.invite_count || 0
      if (newCount % threshold === 0) {
        await db.query('UPDATE users SET quota = quota + ? WHERE id = ?', [rewardQuota, inviterId])
        console.log(`[邀请] 用户 ${inviterId} 达到 ${threshold} 人邀请阈值，奖励 ${rewardQuota} 额度`)
      }
    }
    res.json({ ok: true })
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: '账号已存在，请换一个' })
    res.status(500).json({ error: e.message })
  }
})

// ========== 用户管理 API (admin only) ==========
app.get('/api/users', requireAuth, requireAdmin, async (_req, res) => {
  try { res.json(await dbGetUsers()) }
  catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/users', requireAuth, requireAdmin, async (req, res) => {
  const { username, password, role } = req.body
  if (!username?.trim()) return res.status(400).json({ error: '缺少账号' })
  if (!password?.trim()) return res.status(400).json({ error: '缺少密码' })
  try {
    const id = await dbCreateUser(username.trim(), password.trim(), role === 'admin' ? 'admin' : 'user')
    res.json({ id, ok: true })
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: '账号已存在' })
    res.status(500).json({ error: e.message })
  }
})

app.put('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const { username, password, role } = req.body
  const fields = {}
  if (username?.trim()) fields.username = username.trim()
  if (password?.trim()) fields.password = password.trim()
  if (role) fields.role = role === 'admin' ? 'admin' : 'user'
  try {
    await dbUpdateUser(Number(req.params.id), fields)
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    // 不能删自己
    if (Number(req.params.id) === req.user.userId) return res.status(400).json({ error: '不能删除自己的账号' })
    await dbDeleteUser(Number(req.params.id))
    res.json({ ok: true })
  } catch (e) { res.status(409).json({ error: e.message }) }
})

// POST /api/users/:id/quota [admin] — 手动调整用户额度
app.post('/api/users/:id/quota', requireAuth, requireAdmin, async (req, res) => {
  const { delta } = req.body
  if (typeof delta !== 'number') return res.status(400).json({ error: 'delta 必须是数字' })
  try {
    if (delta >= 0) {
      await db.query('UPDATE users SET quota = quota + ? WHERE id = ?', [delta, Number(req.params.id)])
    } else {
      await db.query('UPDATE users SET quota = GREATEST(0, quota + ?) WHERE id = ?', [delta, Number(req.params.id)])
    }
    const [rows] = await db.query('SELECT quota FROM users WHERE id = ?', [Number(req.params.id)])
    res.json({ ok: true, quota: rows[0]?.quota ?? 0 })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ========== Bots API (需登录，按角色过滤) ==========
// GET /api/bots — Bot 状态（admin 看全部，user 看自己）
app.get('/api/bots', requireAuth, (req, res) => {
  let bots = [...botsMap.values()]
  if (req.user.role !== 'admin') {
    bots = bots.filter(b => b.createdBy === req.user.userId)
  }
  res.json(bots.map(b => b.toInfo()))
})

// POST /api/bots — 创建 Bot
app.post('/api/bots', requireAuth, async (req, res) => {
  const { name, persona, personaId, gender } = req.body
  if (!name?.trim()) return res.status(400).json({ error: '缺少 name 字段' })
  if (!gender || !['male', 'female'].includes(gender)) {
    return res.status(400).json({ error: '请选择性别（male 或 female）' })
  }
  if (personaId) {
    const tpl = await dbGetPersona(personaId)
    if (!tpl) return res.status(400).json({ error: '指定的人设模板不存在' })
  }
  const id  = randomUUID()
  const bot = new BotInstance({
    id, name: name.trim(), persona: persona?.trim() ?? '',
    personaId: personaId ?? null, gender, createdBy: req.user.userId,
  })
  botsMap.set(id, bot)
  await dbUpsertBot({
    id, name: bot.name, persona: bot.persona, personaId: bot.personaId,
    gender: bot.gender, createdBy: bot.createdBy, token: null, baseUrl: BASE_URL, loginTime: null, status: 'offline',
  })
  const result = await bot.startQrFlow()
  res.json({ id, ...result })
})

// DELETE /api/bots/:id — 停止并删除
app.delete('/api/bots/:id', requireAuth, async (req, res) => {
  const bot = botsMap.get(req.params.id)
  if (!bot) return res.status(404).json({ error: '未找到该 Bot' })
  if (req.user.role !== 'admin' && bot.createdBy !== req.user.userId) {
    return res.status(403).json({ error: '无权删除此 Bot' })
  }
  bot.stop()
  botsMap.delete(req.params.id)
  await dbDeleteBot(req.params.id)
  res.json({ ok: true })
})

// GET /api/bots/:id/history — 聊天历史（按用户分组）
app.get('/api/bots/:id/history', requireAuth, async (req, res) => {
  try {
    const [users] = await db.query(
      `SELECT DISTINCT user_id, MIN(created_at) AS first_at
       FROM user_histories WHERE bot_id = ?
       GROUP BY user_id ORDER BY first_at ASC`,
      [req.params.id]
    )
    const result = []
    for (const { user_id } of users) {
      const [msgs] = await db.query(
        `SELECT role, content, created_at
         FROM user_histories WHERE bot_id = ? AND user_id = ? ORDER BY id ASC`,
        [req.params.id, user_id]
      )
      result.push({
        userId: user_id,
        messages: msgs.map(m => ({
          role: m.role,
          content: m.content,
          time: new Date(m.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
        })),
      })
    }
    res.json(result)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// POST /api/bots/:id/reconnect — 重连 or 重新扫码
app.post('/api/bots/:id/reconnect', requireAuth, (req, res) => {
  const bot = botsMap.get(req.params.id)
  if (!bot) return res.status(404).json({ error: '未找到该 Bot' })
  if (['expired', 'offline'].includes(bot.status)) {
    bot.startQrFlow()
  } else {
    bot.doReconnect()
  }
  res.json({ ok: true })
})

// GET /api/config — 获取全局 AI 配置（key 脱敏）
app.get('/api/config', (_req, res) => {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'))
    const masked = JSON.parse(JSON.stringify(raw))
    if (masked.providers) {
      for (const k of Object.keys(masked.providers)) {
        const key = masked.providers[k].api_key ?? ''
        masked.providers[k].api_key = key.length > 10 ? `${key.slice(0, 5)}***${key.slice(-4)}` : '***'
      }
    }
    res.json(masked)
  } catch { res.json({}) }
})

// POST /api/config — 更新全局 AI 配置
app.post('/api/config', (req, res) => {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(req.body, null, 2), 'utf-8')
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ========== Personas 人设库 CRUD ==========
// GET /api/personas — 获取所有模板
app.get('/api/personas', async (_req, res) => {
  try { res.json(await dbGetPersonas()) }
  catch (e) { res.status(500).json({ error: e.message }) }
})

// POST /api/personas — 新建模板
app.post('/api/personas', async (req, res) => {
  const { name, content, isDefault } = req.body
  if (!name?.trim()) return res.status(400).json({ error: '缺少 name' })
  if (!content?.trim()) return res.status(400).json({ error: '缺少 content' })
  try {
    const id = await dbCreatePersona(name.trim(), content.trim(), !!isDefault)
    res.json({ id, ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// PUT /api/personas/:id — 更新模板
app.put('/api/personas/:id', async (req, res) => {
  const { name, content, isDefault } = req.body
  if (!name?.trim()) return res.status(400).json({ error: '缺少 name' })
  if (!content?.trim()) return res.status(400).json({ error: '缺少 content' })
  try {
    // 更新后刷新使用该模板的 Bot 缓存
    await dbUpdatePersona(Number(req.params.id), name.trim(), content.trim(), !!isDefault)
    for (const bot of botsMap.values()) {
      if (bot.personaId === Number(req.params.id)) bot._personaCache = null
    }
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// DELETE /api/personas/:id — 删除模板
app.delete('/api/personas/:id', async (req, res) => {
  try {
    await dbDeletePersona(Number(req.params.id))
    res.json({ ok: true })
  } catch (e) { res.status(409).json({ error: e.message }) }
})

// PATCH /api/personas/:id/default — 设为默认
app.patch('/api/personas/:id/default', async (req, res) => {
  try {
    await dbSetDefaultPersona(Number(req.params.id))
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ========== AI Providers CRUD ==========
// GET /api/ai-providers — 列表（api_key 脱敏）
app.get('/api/ai-providers', async (_req, res) => {
  try {
    const rows = await dbGetProviders()
    res.json(rows)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// GET /api/ai-providers/:id/key — 单条 api_key（脱敏，供显示用）
app.get('/api/ai-providers/:id/key', async (req, res) => {
  try {
    const p = await dbGetProvider(Number(req.params.id))
    if (!p) return res.status(404).json({ error: '未找到' })
    const key = p.api_key ?? ''
    res.json({ maskedKey: key.length > 10 ? `${key.slice(0, 5)}***${key.slice(-4)}` : '***', fullKey: key })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// POST /api/ai-providers — 新建
app.post('/api/ai-providers', async (req, res) => {
  const { name, baseUrl, apiKey, model, prompt } = req.body
  if (!name?.trim())    return res.status(400).json({ error: '缺少名称' })
  if (!baseUrl?.trim()) return res.status(400).json({ error: '缺少 Base URL' })
  if (!apiKey?.trim())  return res.status(400).json({ error: '缺少 API Key' })
  if (!model?.trim())   return res.status(400).json({ error: '缺少模型名' })
  try {
    const id = await dbCreateProvider(name.trim(), baseUrl.trim(), apiKey.trim(), model.trim(), prompt ?? '')
    res.json({ id, ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// PUT /api/ai-providers/:id — 更新（apiKey 为空时不覆盖）
app.put('/api/ai-providers/:id', async (req, res) => {
  const { name, baseUrl, apiKey, model, prompt } = req.body
  if (!name?.trim())    return res.status(400).json({ error: '缺少名称' })
  if (!baseUrl?.trim()) return res.status(400).json({ error: '缺少 Base URL' })
  if (!model?.trim())   return res.status(400).json({ error: '缺少模型名' })
  try {
    await dbUpdateProvider(Number(req.params.id), name.trim(), baseUrl.trim(), apiKey ?? '', model.trim(), prompt ?? '')
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// DELETE /api/ai-providers/:id — 删除
app.delete('/api/ai-providers/:id', async (req, res) => {
  try {
    await dbDeleteProvider(Number(req.params.id))
    res.json({ ok: true })
  } catch (e) { res.status(409).json({ error: e.message }) }
})

// PATCH /api/ai-providers/:id/active — 切换使用
app.patch('/api/ai-providers/:id/active', async (req, res) => {
  try {
    await dbSetActiveProvider(Number(req.params.id))
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ========== Prompt Templates API ==========
app.get('/api/prompt-templates', requireAuth, async (_req, res) => {
  try { res.json(await dbGetPromptTemplates()) }
  catch (e) { res.status(500).json({ error: e.message }) }
})
app.post('/api/prompt-templates', requireAuth, requireAdmin, async (req, res) => {
  const { name, content } = req.body
  if (!name?.trim())    return res.status(400).json({ error: '缺少名称' })
  if (!content?.trim()) return res.status(400).json({ error: '缺少内容' })
  try {
    const id = await dbCreatePromptTemplate(name.trim(), content.trim())
    res.json({ id, ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
app.put('/api/prompt-templates/:id', requireAuth, requireAdmin, async (req, res) => {
  const { name, content } = req.body
  if (!name?.trim())    return res.status(400).json({ error: '缺少名称' })
  if (!content?.trim()) return res.status(400).json({ error: '缺少内容' })
  try {
    await dbUpdatePromptTemplate(Number(req.params.id), name.trim(), content.trim())
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
app.delete('/api/prompt-templates/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await dbDeletePromptTemplate(Number(req.params.id))
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ========== 生成人设 API ==========
// POST /api/generate-persona — 根据聊天记录 + 前置提示词，调用 claude-opus-4-6 生成人设
app.post('/api/generate-persona', requireAuth, async (req, res) => {
  const { chatContent, prePrompt } = req.body
  if (!chatContent?.trim()) return res.status(400).json({ error: '请提供聊天内容' })

  // 获取 dusapi 配置（优先从 DB 找 dusapi.com 的 provider）
  let apiKey = ''
  try {
    const [rows] = await db.query(
      "SELECT api_key FROM ai_providers WHERE base_url LIKE '%dusapi%' ORDER BY id LIMIT 1"
    )
    if (rows[0]) {
      apiKey = rows[0].api_key
    } else {
      // 回退：读 config.json
      const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'))
      apiKey = raw.providers?.dusapi?.api_key ?? raw.api_key ?? ''
    }
  } catch (e) { return res.status(500).json({ error: '无法获取 API Key: ' + e.message }) }

  if (!apiKey) return res.status(400).json({ error: '未配置 DusAPI Key，请先在 AI 配置中添加 dusapi.com 的配置' })

  // 构建 system instructions
  const DEFAULT_GEN_PROMPT = `你是一个专业的 AI 人设分析专家。
用户将提供一段聊天记录，请仔细分析其中说话人的语言习惯、性格特点、口头禅、说话节奏、常用词汇、情感表达方式等。
然后生成一份详细的 AI 人设描述，让 AI 助手能够完整模拟该说话人的聊天风格。
输出格式：直接输出人设描述文本，不需要标题、不需要分析过程，只输出最终可用于 Prompt 的人设内容。`

  const instructions = prePrompt?.trim()
    ? `${prePrompt.trim()}\n\n${DEFAULT_GEN_PROMPT}`
    : DEFAULT_GEN_PROMPT

  try {
    const apiRes = await fetch('https://api.dusapi.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'claude-opus-4-6',
        instructions,
        input: `以下是聊天记录，请根据其中说话人的风格生成人设：\n\n${chatContent.trim()}`,
      }),
    })
    const data = await apiRes.json()
    if (!apiRes.ok) return res.status(apiRes.status).json({ error: data?.error?.message ?? '生成失败' })

    // 解析响应 output[0].content[0].text 或 output_text
    let text = data?.output?.[0]?.content?.[0]?.text
            ?? data?.output_text
            ?? data?.choices?.[0]?.message?.content
            ?? ''
    text = text.trim()
    if (!text) return res.status(500).json({ error: 'AI 未返回有效内容' })
    res.json({ persona: text })
  } catch (e) { res.status(500).json({ error: '请求失败: ' + e.message }) }
})

// ========== 套餐 API ==========
app.get('/api/packages', requireAuth, async (_req, res) => {
  try { res.json(await dbGetPackages()) }
  catch (e) { res.status(500).json({ error: e.message }) }
})
app.post('/api/packages', requireAuth, requireAdmin, async (req, res) => {
  const { name, quota, price } = req.body
  if (!name?.trim())      return res.status(400).json({ error: '缺少套餐名称' })
  if (!quota || quota <= 0) return res.status(400).json({ error: '额度条数必须大于0' })
  if (!price || price <= 0) return res.status(400).json({ error: '价格必须大于0' })
  try { res.json({ id: await dbCreatePackage(name.trim(), Number(quota), Number(price)), ok: true }) }
  catch (e) { res.status(500).json({ error: e.message }) }
})
app.put('/api/packages/:id', requireAuth, requireAdmin, async (req, res) => {
  const { name, quota, price, isActive } = req.body
  if (!name?.trim()) return res.status(400).json({ error: '缺少套餐名称' })
  try { await dbUpdatePackage(Number(req.params.id), name.trim(), Number(quota), Number(price), isActive !== false); res.json({ ok: true }) }
  catch (e) { res.status(500).json({ error: e.message }) }
})
app.delete('/api/packages/:id', requireAuth, requireAdmin, async (req, res) => {
  try { await dbDeletePackage(Number(req.params.id)); res.json({ ok: true }) }
  catch (e) { res.status(500).json({ error: e.message }) }
})

// ========== 系统配置 API ==========
app.get('/api/system-config', requireAuth, requireAdmin, async (_req, res) => {
  try { res.json(await dbGetAllSystemConfig()) }
  catch (e) { res.status(500).json({ error: e.message }) }
})
app.put('/api/system-config', requireAuth, requireAdmin, async (req, res) => {
  const { key, value } = req.body
  if (!key) return res.status(400).json({ error: '缺少 key' })
  if (value === undefined || value === null) return res.status(400).json({ error: '缺少 value' })
  try { await dbSetSystemConfig(key, String(value)); res.json({ ok: true }) }
  catch (e) { res.status(500).json({ error: e.message }) }
})

// ========== 微信支付配置 CRUD API ==========
app.get('/api/wx-pay-configs', requireAuth, requireAdmin, async (_req, res) => {
  try { res.json(await dbGetWxPayConfigs()) }
  catch (e) { res.status(500).json({ error: e.message }) }
})
app.post('/api/wx-pay-configs', requireAuth, requireAdmin, async (req, res) => {
  const { name, appId, appSecret, mchId, mchKey, keyPath, notifyUrl } = req.body
  if (!name?.trim())   return res.status(400).json({ error: '缺少配置名称' })
  if (!appId?.trim())  return res.status(400).json({ error: '缺少 app_id' })
  if (!mchId?.trim())  return res.status(400).json({ error: '缺少 mch_id' })
  if (!mchKey?.trim()) return res.status(400).json({ error: '缺少 mch_key' })
  try {
    const id = await dbCreateWxPayConfig(
      name.trim(), appId.trim(), appSecret?.trim() ?? '', mchId.trim(),
      mchKey.trim(), keyPath?.trim() ?? '', notifyUrl?.trim() ?? ''
    )
    res.json({ id, ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
app.put('/api/wx-pay-configs/:id', requireAuth, requireAdmin, async (req, res) => {
  const { name, appId, appSecret, mchId, mchKey, keyPath, notifyUrl } = req.body
  if (!name?.trim())  return res.status(400).json({ error: '缺少配置名称' })
  if (!appId?.trim()) return res.status(400).json({ error: '缺少 app_id' })
  if (!mchId?.trim()) return res.status(400).json({ error: '缺少 mch_id' })
  try {
    await dbUpdateWxPayConfig(
      Number(req.params.id), name.trim(), appId.trim(), appSecret?.trim() ?? '',
      mchId.trim(), mchKey ?? '', keyPath?.trim() ?? '', notifyUrl?.trim() ?? ''
    )
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
app.delete('/api/wx-pay-configs/:id', requireAuth, requireAdmin, async (req, res) => {
  try { await dbDeleteWxPayConfig(Number(req.params.id)); res.json({ ok: true }) }
  catch (e) { res.status(409).json({ error: e.message }) }
})
app.patch('/api/wx-pay-configs/:id/active', requireAuth, requireAdmin, async (req, res) => {
  try { await dbSetActiveWxPayConfig(Number(req.params.id)); res.json({ ok: true }) }
  catch (e) { res.status(500).json({ error: e.message }) }
})

// ========== 微信支付 SDK (V2) ==========
async function wxGetConfig() {
  // 1. 优先从 wx_pay_configs 表取活跃配置（带 1分钟缓存）
  if (_wxPayConfigCache && Date.now() < _wxPayConfigCacheExp) return _wxPayConfigCache
  try {
    const [rows] = await db.query('SELECT * FROM wx_pay_configs WHERE is_active = 1 LIMIT 1')
    if (rows[0]) {
      const c = rows[0]
      c._appid     = c.app_id     || ''
      c._mchid     = c.mch_id     || ''
      c._mchkey    = c.mch_key    || ''
      c._appSecret = c.app_secret || ''
      c._notifyUrl = c.notify_url || ''
      _wxPayConfigCache    = c
      _wxPayConfigCacheExp = Date.now() + 60000
      return c
    }
  } catch {}
  // 2. 回退到 system_config（兼容旧配置）
  const keys = [
    'wx_appid','wx_mchid','wx_api_key','wx_cert_serial','wx_private_key',
    'wx_notify_url','wx_app_secret',
    'app_id','mch_id','mch_key','key_path','notify_url',
  ]
  const [rows] = await db.query(
    `SELECT cfg_key, cfg_value FROM system_config WHERE cfg_key IN (${keys.map(() => '?').join(',')})`, keys
  )
  const cfg = {}
  for (const r of rows) cfg[r.cfg_key] = r.cfg_value
  cfg._appid     = cfg.app_id     || cfg.wx_appid  || ''
  cfg._mchid     = cfg.mch_id     || cfg.wx_mchid  || ''
  cfg._mchkey    = cfg.mch_key    || ''
  cfg._appSecret = cfg.wx_app_secret || ''
  cfg._notifyUrl = cfg.notify_url || cfg.wx_notify_url || ''
  return cfg
}

// XML 工具函数
function buildXml(obj) {
  return '<xml>' + Object.entries(obj)
    .map(([k, v]) => `<${k}><![CDATA[${v}]]></${k}>`).join('') + '</xml>'
}
function parseXml(xml) {
  const result = {}
  const re = /<(\w+)>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*?))<\/\1>/g
  let m
  while ((m = re.exec(xml)) !== null) result[m[1]] = m[2] !== undefined ? m[2] : m[3]
  return result
}

// V2 签名（MD5）
function wxV2Sign(params, key) {
  const str = Object.keys(params).sort()
    .filter(k => params[k] !== '' && params[k] !== undefined && params[k] !== null
                 && k !== 'sign' && k !== 'paySign')
    .map(k => `${k}=${params[k]}`).join('&') + '&key=' + key
  return createHash('md5').update(str).digest('hex').toUpperCase()
}

// V2 JSAPI 统一下单
async function createV2JsapiOrder(orderId, description, amountYuan, openid) {
  const cfg = await wxGetConfig()
  if (!cfg._appid || !cfg._mchid || !cfg._mchkey) {
    throw new Error('微信支付未配置，请在系统设置中填写 app_id、mch_id、mch_key')
  }
  const actualNotifyUrl = cfg._notifyUrl || 'http://your-domain/api/wx-pay/notify'
  console.log(`[${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}] [WxPay JSAPI下单] orderId=${orderId}, notify_url=${actualNotifyUrl}`)
  const nonceStr = randomBytes(16).toString('hex').substring(0, 32)
  const params = {
    appid:            cfg._appid,
    mch_id:           cfg._mchid,
    nonce_str:        nonceStr,
    body:             description,
    out_trade_no:     orderId,
    total_fee:        String(Math.round(amountYuan * 100)),
    spbill_create_ip: '127.0.0.1',
    notify_url:       actualNotifyUrl,
    trade_type:       'JSAPI',
    openid:           openid,
  }
  params.sign = wxV2Sign(params, cfg._mchkey)
  const xml  = buildXml(params)
  const resp = await fetch('https://api.mch.weixin.qq.com/pay/unifiedorder', {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
    body: xml,
  })
  const text   = await resp.text()
  const result = parseXml(text)
  if (result.return_code !== 'SUCCESS') throw new Error(result.return_msg || '请求失败')
  if (result.result_code !== 'SUCCESS') throw new Error(result.err_code_des || result.err_code || '下单失败')
  return result.prepay_id
}

// V2 Native 扫码支付
async function createV2NativeOrder(orderId, description, amountYuan) {
  const cfg = await wxGetConfig()
  if (!cfg._appid || !cfg._mchid || !cfg._mchkey) {
    throw new Error('微信支付未配置，请先在「支付配置」中填写 app_id、mch_id、mch_key')
  }
  const actualNotifyUrl = cfg._notifyUrl || 'http://your-domain/api/wx-pay/notify'
  console.log(`[${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}] [WxPay下单] orderId=${orderId}, notify_url=${actualNotifyUrl}`)
  const nonceStr = randomBytes(16).toString('hex').substring(0, 32)
  const params = {
    appid:            cfg._appid,
    mch_id:           cfg._mchid,
    nonce_str:        nonceStr,
    body:             description,
    out_trade_no:     orderId,
    total_fee:        String(Math.round(amountYuan * 100)),
    spbill_create_ip: '127.0.0.1',
    notify_url:       actualNotifyUrl,
    trade_type:       'NATIVE',
  }
  params.sign = wxV2Sign(params, cfg._mchkey)
  const xml  = buildXml(params)
  const resp = await fetch('https://api.mch.weixin.qq.com/pay/unifiedorder', {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
    body: xml,
  })
  const text   = await resp.text()
  const result = parseXml(text)
  if (result.return_code !== 'SUCCESS') throw new Error(result.return_msg || '请求失败')
  if (result.result_code !== 'SUCCESS') throw new Error(result.err_code_des || result.err_code || '下单失败')
  return result.code_url
}

// V2 前端支付参数签名
function signV2JsapiParams(appId, prepayId, mchKey) {
  const timeStamp = String(Math.floor(Date.now() / 1000))
  const nonceStr  = randomBytes(8).toString('hex')
  const pkg       = `prepay_id=${prepayId}`
  const paySign   = wxV2Sign({ appId, timeStamp, nonceStr, package: pkg, signType: 'MD5' }, mchKey)
  return { appId, timeStamp, nonceStr, package: pkg, signType: 'MD5', paySign }
}

// JSSDK jsapi_ticket 缓存
let _wxAccessToken = null, _wxAccessTokenExp = 0
let _wxJsapiTicket = null, _wxJsapiTicketExp = 0
async function wxGetAccessToken() {
  if (_wxAccessToken && Date.now() < _wxAccessTokenExp) return _wxAccessToken
  const cfg = await wxGetConfig()
  if (!cfg._appid || !cfg._appSecret) throw new Error('未配置AppID或AppSecret')
  const resp = await fetch(`https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${cfg._appid}&secret=${cfg._appSecret}`)
  const data = await resp.json()
  if (data.errcode) throw new Error(`获取access_token失败: ${data.errmsg}`)
  _wxAccessToken    = data.access_token
  _wxAccessTokenExp = Date.now() + (data.expires_in - 300) * 1000
  return _wxAccessToken
}
async function wxGetJsapiTicket() {
  if (_wxJsapiTicket && Date.now() < _wxJsapiTicketExp) return _wxJsapiTicket
  const token = await wxGetAccessToken()
  const resp  = await fetch(`https://api.weixin.qq.com/cgi-bin/ticket/getticket?access_token=${token}&type=jsapi`)
  const data  = await resp.json()
  if (data.errcode !== 0) throw new Error(`获取jsapi_ticket失败: ${data.errmsg}`)
  _wxJsapiTicket    = data.ticket
  _wxJsapiTicketExp = Date.now() + (data.expires_in - 300) * 1000
  return _wxJsapiTicket
}

// ========== 微信OAuth + JSSDK 配置 ==========
// GET /api/wx-oauth/url — 生成OAuth授权URL
app.get('/api/wx-oauth/url', requireAuth, async (req, res) => {
  try {
    const cfg = await wxGetConfig()
    if (!cfg._appid) return res.status(400).json({ error: '未配置微信AppID（app_id）' })
    const redirectUri = encodeURIComponent(req.query.redirect || `${req.protocol}://${req.get('host')}`)
    const url = `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${cfg._appid}&redirect_uri=${redirectUri}&response_type=code&scope=snsapi_base&state=pay#wechat_redirect`
    res.json({ url })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
// POST /api/wx-oauth/exchange — code换openid
app.post('/api/wx-oauth/exchange', requireAuth, async (req, res) => {
  const { code } = req.body
  if (!code) return res.status(400).json({ error: '缺少code' })
  try {
    const cfg  = await wxGetConfig()
    const resp = await fetch(`https://api.weixin.qq.com/sns/oauth2/access_token?appid=${cfg._appid}&secret=${cfg._appSecret}&code=${code}&grant_type=authorization_code`)
    const data = await resp.json()
    if (data.errcode) return res.status(400).json({ error: `获取openid失败: ${data.errmsg}` })
    await db.query('UPDATE users SET openid = ? WHERE id = ?', [data.openid, req.user.userId])
    res.json({ openid: data.openid })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
// GET /api/wx-jssdk-config — 获取JSSDK签名配置
app.get('/api/wx-jssdk-config', requireAuth, async (req, res) => {
  const url = req.query.url
  if (!url) return res.status(400).json({ error: '缺少url' })
  try {
    const cfg    = await wxGetConfig()
    const ticket = await wxGetJsapiTicket()
    const nonce  = randomBytes(8).toString('hex')
    const ts     = String(Math.floor(Date.now() / 1000))
    const str    = `jsapi_ticket=${ticket}&noncestr=${nonce}&timestamp=${ts}&url=${url}`
    const sig    = createHash('sha1').update(str).digest('hex')
    res.json({ appId: cfg._appid, nonceStr: nonce, timestamp: ts, signature: sig })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ========== 订单 API ==========
// POST /api/orders — 用户下单
// payType: 'native'(默认,扫码) | 'jsapi'(小程序/公众号内)
app.post('/api/orders', requireAuth, async (req, res) => {
  const { packageId, openid, payType = 'native' } = req.body
  if (!packageId) return res.status(400).json({ error: '缺少 packageId' })
  try {
    const [pkgRows] = await db.query('SELECT * FROM packages WHERE id = ? AND is_active = 1', [Number(packageId)])
    const pkg = pkgRows[0]
    if (!pkg) return res.status(404).json({ error: '套餐不存在或已下架' })
    const orderId = randomUUID().replace(/-/g, '').substring(0, 32)
    let jsapiParams = null
    let codeUrl     = null
    if (payType === 'jsapi' && openid) {
      // JSAPI 支付（小程序 / 公众号内）
      try {
        const prepayId = await createV2JsapiOrder(orderId, pkg.name, Number(pkg.price), openid)
        const cfg      = await wxGetConfig()
        jsapiParams    = signV2JsapiParams(cfg._appid, prepayId, cfg._mchkey)
      } catch (e) { console.log('[WxPay V2 JSAPI] 下单失败:', e.message) }
    } else {
      // Native 扫码支付（默认，PC / 手机均可）
      try {
        codeUrl = await createV2NativeOrder(orderId, pkg.name, Number(pkg.price))
      } catch (e) {
        console.log('[WxPay V2 Native] 下单失败:', e.message)
        return res.status(500).json({ error: e.message })
      }
    }
    await dbCreateOrder(orderId, req.user.userId, pkg.id, pkg.price, pkg.quota)
    res.json({ orderId, jsapiParams, codeUrl, amount: pkg.price, quota: pkg.quota, name: pkg.name })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// GET /api/orders/:id — 查询订单状态
app.get('/api/orders/:id', requireAuth, async (req, res) => {
  try {
    const order = await dbGetOrder(req.params.id)
    if (!order) return res.status(404).json({ error: '订单不存在' })
    if (order.user_id !== req.user.userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: '无权查看此订单' })
    }
    res.json({ id: order.id, status: order.status, amount: order.amount, quota: order.quota, paid_at: order.paid_at })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// POST /api/wx-pay/notify — 微信支付V2 XML回调
app.post('/api/wx-pay/notify', express.text({ type: '*/*', limit: '1mb' }), async (req, res) => {
  const ts = () => new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
  const xmlReply = (code, msg) =>
    `<xml><return_code><![CDATA[${code}]]></return_code><return_msg><![CDATA[${msg}]]></return_msg></xml>`

  console.log(`[${ts()}] [WxPay回调] ===== 收到微信支付回调请求 =====`)
  console.log(`[${ts()}] [WxPay回调] Headers:`, JSON.stringify(req.headers).slice(0, 300))
  console.log(`[${ts()}] [WxPay回调] Body长度: ${req.body?.length || 0}, 内容前200字: ${String(req.body || '').slice(0, 200)}`)

  try {
    const xmlBody = typeof req.body === 'string' ? req.body : ''
    if (!xmlBody) {
      console.log(`[${ts()}] [WxPay回调] ❌ 请求体为空，返回FAIL`)
      return res.type('xml').send(xmlReply('FAIL', '无效通知'))
    }

    const params = parseXml(xmlBody)
    console.log(`[${ts()}] [WxPay回调] 解析XML参数:`, JSON.stringify({ return_code: params.return_code, result_code: params.result_code, out_trade_no: params.out_trade_no, total_fee: params.total_fee }))

    // MD5 验签
    const cfg = await wxGetConfig()
    console.log(`[${ts()}] [WxPay回调] 支付配置: appid=${cfg._appid}, mchid=${cfg._mchid}, hasKey=${!!cfg._mchkey}, notifyUrl=${cfg._notifyUrl}`)

    if (cfg._mchkey) {
      const received = params.sign
      const computed = wxV2Sign(params, cfg._mchkey)
      if (received !== computed) {
        console.error(`[${ts()}] [WxPay回调] ❌ 签名验证失败 received=${received?.slice(0,10)}... computed=${computed?.slice(0,10)}...`)
        return res.type('xml').send(xmlReply('FAIL', '签名验证失败'))
      }
      console.log(`[${ts()}] [WxPay回调] ✅ 签名验证通过`)
    } else {
      console.log(`[${ts()}] [WxPay回调] ⚠️ 未配置mch_key，跳过签名验证`)
    }

    if (params.return_code !== 'SUCCESS' || params.result_code !== 'SUCCESS') {
      console.log(`[${ts()}] [WxPay回调] ❌ 交易未成功: return_code=${params.return_code}, result_code=${params.result_code}, err=${params.err_code_des || params.return_msg}`)
      return res.type('xml').send(xmlReply('SUCCESS', 'OK'))
    }

    const orderId = params.out_trade_no
    const order   = await dbGetOrder(orderId)
    if (!order) {
      console.log(`[${ts()}] [WxPay回调] ❌ 订单不存在: ${orderId}`)
      return res.type('xml').send(xmlReply('FAIL', '订单不存在'))
    }
    console.log(`[${ts()}] [WxPay回调] 订单信息: id=${orderId}, user_id=${order.user_id}, quota=${order.quota}, status=${order.status}`)

    if (order.status === 'paid') {
      console.log(`[${ts()}] [WxPay回调] ⚠️ 订单已处理过，跳过重复通知`)
      return res.type('xml').send(xmlReply('SUCCESS', 'OK'))
    }

    await dbUpdateOrderStatus(orderId, 'paid')
    await db.query('UPDATE users SET quota = quota + ? WHERE id = ?', [order.quota, order.user_id])
    console.log(`[${ts()}] [WxPay回调] ✅ 订单 ${orderId} 支付成功！用户 ${order.user_id} 增加 ${order.quota} 额度`)
    res.type('xml').send(xmlReply('SUCCESS', 'OK'))
  } catch (e) {
    console.error(`[${ts()}] [WxPay回调] ❌ 处理异常:`, e.message, e.stack?.slice(0, 200))
    res.type('xml').send(xmlReply('FAIL', e.message))
  }
})

// ========== 定时消息 CRUD API ==========
app.get('/api/scheduled-messages', requireAuth, requireAdmin, async (_req, res) => {
  try { res.json(await dbGetScheduledMessages()) }
  catch (e) { res.status(500).json({ error: e.message }) }
})
app.post('/api/scheduled-messages', requireAuth, requireAdmin, async (req, res) => {
  const { name, sendTime, message, targetBot, useAi, aiPrompt, timeWindow } = req.body
  if (!name?.trim())     return res.status(400).json({ error: '缺少名称' })
  if (!sendTime?.trim()) return res.status(400).json({ error: '缺少发送时间' })
  if (!/^\d{2}:\d{2}$/.test(sendTime)) return res.status(400).json({ error: '时间格式错误，请用 HH:MM' })
  if (!useAi && !message?.trim()) return res.status(400).json({ error: '未启用AI时备用文案不能为空' })
  try {
    const id = await dbCreateScheduledMsg(name.trim(), sendTime, message?.trim() || '', targetBot || null, !!useAi, aiPrompt?.trim() || null, Number(timeWindow) || 0)
    res.json({ id, ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
app.put('/api/scheduled-messages/:id', requireAuth, requireAdmin, async (req, res) => {
  const { name, sendTime, message, targetBot, isActive, useAi, aiPrompt, timeWindow } = req.body
  if (!name?.trim())     return res.status(400).json({ error: '缺少名称' })
  if (!sendTime?.trim()) return res.status(400).json({ error: '缺少发送时间' })
  if (!/^\d{2}:\d{2}$/.test(sendTime)) return res.status(400).json({ error: '时间格式错误，请用 HH:MM' })
  if (!useAi && !message?.trim()) return res.status(400).json({ error: '未启用AI时备用文案不能为空' })
  try {
    await dbUpdateScheduledMsg(Number(req.params.id), name.trim(), sendTime, message?.trim() || '', targetBot || null, isActive !== false, !!useAi, aiPrompt?.trim() || null, Number(timeWindow) || 0)
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
app.delete('/api/scheduled-messages/:id', requireAuth, requireAdmin, async (req, res) => {
  try { await dbDeleteScheduledMsg(Number(req.params.id)); res.json({ ok: true }) }
  catch (e) { res.status(500).json({ error: e.message }) }
})
// POST /api/scheduled-messages/:id/send-now — 立即测试发送
app.post('/api/scheduled-messages/:id/send-now', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM scheduled_messages WHERE id = ?', [Number(req.params.id)])
    const msg = rows[0]
    if (!msg) return res.status(404).json({ error: '消息不存在' })
    const count = await broadcastScheduledMessage(msg)
    res.json({ ok: true, sent: count })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ========== 记忆与人设管理 API ==========
// GET /api/memory/:botId/:userId — 获取全部长期记忆
app.get('/api/memory/:botId/:userId', requireAuth, requireAdmin, async (req, res) => {
  try { res.json(await dbGetAllLongMemory(req.params.botId, req.params.userId)) }
  catch (e) { res.status(500).json({ error: e.message }) }
})
// DELETE /api/memory/:id — 删除单条记忆
app.delete('/api/memory/:id', requireAuth, requireAdmin, async (req, res) => {
  try { await dbDeleteLongMemory(Number(req.params.id)); res.json({ ok: true }) }
  catch (e) { res.status(500).json({ error: e.message }) }
})
// GET /api/base-role/:botId/:userId — 获取专属人设
app.get('/api/base-role/:botId/:userId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const row = await dbGetBaseRole(req.params.botId, req.params.userId)
    res.json(row ?? { bot_id: req.params.botId, user_id: req.params.userId, base_prompt: '', last_update: null })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
// PUT /api/base-role/:botId/:userId — 手动编辑人设
app.put('/api/base-role/:botId/:userId', requireAuth, requireAdmin, async (req, res) => {
  const { base_prompt } = req.body
  if (base_prompt === undefined) return res.status(400).json({ error: '缺少 base_prompt' })
  try {
    await dbInitBaseRole(req.params.botId, req.params.userId)
    await dbSetBaseRole(req.params.botId, req.params.userId, base_prompt)
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
// GET /api/memory-users — 返回最近活跃用户列表（供前端下拉选择）
app.get('/api/memory-users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT bot_id, from_id AS user_id, last_seen FROM user_sessions ORDER BY last_seen DESC LIMIT 200'
    )
    res.json(rows)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// SPA fallback — 必须放在所有 API 路由之后
if (fs.existsSync(frontendDist)) {
  app.get('*', (_req, res) => res.sendFile(path.join(frontendDist, 'index.html')))
}

// ========== 定时消息广播引擎 ==========
async function broadcastScheduledMessage(msg) {
  let messageText = msg.message || ''

  // AI 生成内容
  if (msg.use_ai && msg.ai_prompt) {
    try {
      const now = new Date()
      const timeCtx = `现在是${now.getHours()}时${now.getMinutes()}分`
      messageText = await callAI(
        '你是一个温柔有个性的AI聊天伙伴，根据提示生成一条微信消息，自然亲切，不超过80字。',
        `${msg.ai_prompt}\n\n时间背景：${timeCtx}`,
        300
      )
    } catch (e) {
      console.log(`[定时消息「${msg.name}」] AI生成失败，使用备用文案:`, e.message)
    }
  }

  if (!messageText) {
    console.log(`[定时消息「${msg.name}」] 无消息内容，跳过`)
    return 0
  }

  const sessions = await dbGetUserSessions(msg.target_bot || null, 72)
  let sent = 0
  for (const session of sessions) {
    const bot = botsMap.get(session.bot_id)
    if (!bot || bot.status !== 'active') continue
    try {
      await bot.sendMsgSafe(session.from_id, session.context_token, messageText)
      sent++
      await new Promise(r => setTimeout(r, 150))
    } catch (e) {
      console.log(`[定时消息] 发送失败 bot=${session.bot_id} user=${session.from_id}: ${e.message}`)
    }
  }
  console.log(`[定时消息「${msg.name}」] 共发送 ${sent}/${sessions.length} 个用户`)
  return sent
}

// ========== node-cron 调度器 ==========
function initScheduler() {
  cron.schedule('* * * * *', async () => {
    const now     = new Date()
    const nowMins = now.getHours() * 60 + now.getMinutes()
    try {
      const msgs = await dbGetScheduledMessages(true)
      for (const msg of msgs) {
        const fireMins = getTodayFireMinute(msg.id, msg.send_time, msg.time_window || 0)
        if (nowMins === fireMins) {
          const fireHH = String(Math.floor(fireMins / 60)).padStart(2, '0')
          const fireMM = String(fireMins % 60).padStart(2, '0')
          console.log(`[定时调度] 触发「${msg.name}」 @ ${fireHH}:${fireMM} (窗口偏移 ${fireMins - (msg.send_time.split(':').map(Number)[0]*60 + msg.send_time.split(':').map(Number)[1])} 分钟)`)
          broadcastScheduledMessage(msg).catch(e => console.error('[定时调度] 广播失败:', e.message))
        }
      }
    } catch (e) { console.error('[定时调度] 检查失败:', e.message) }
  })
  console.log('[定时调度器] 已启动，每分钟检查一次')

  // 每周一凌晨 3 点执行人设自动进化
  cron.schedule('0 3 * * 1', async () => {
    console.log('[人设进化] 开始每周任务...')
    try {
      const since = new Date(Date.now() - 7 * 24 * 3600 * 1000)
      const [combos] = await db.query(
        'SELECT DISTINCT bot_id, user_id FROM tb_chat_record WHERE created_at > ?', [since]
      )
      let processed = 0
      for (const { bot_id, user_id } of combos) {
        try {
          const records = await dbGetWeeklyChatRecord(bot_id, user_id, since)
          const filtered = records.filter(r => r.content.length >= 4)
            .reduce((acc, r) => {
              const last = acc[acc.length - 1]
              if (!last || last.content !== r.content) acc.push(r)
              return acc
            }, []).slice(-60)
          if (filtered.length < 6) continue
          const dialogue = filtered.map(r => (r.role === 'user' ? '用户：' : 'AI：') + r.content).join('\n')
          const newTraits = await callAI(
            '你是人格分析师，精简输出，不要多余描述。',
            `根据下面 7 天对话，提炼：1.AI新增口头禅/常用语气词；2.新养成的说话小习惯；3.两人专属小棖。每项精简一句。\n\n${dialogue}`,
            200
          )
          if (newTraits && newTraits.trim()) {
            const today = new Date().toISOString().slice(0, 10)
            await dbAppendBaseRole(bot_id, user_id, `\n[【${today}新增习惯】${newTraits.trim()}]`)
            await db.query('UPDATE tb_base_role SET last_update=? WHERE bot_id=? AND user_id=?', [today, bot_id, user_id])
            processed++
          }
          await new Promise(r => setTimeout(r, 500)) // 限流
        } catch (e) { console.log(`[人设进化] 处理 ${bot_id}/${user_id} 失败:`, e.message) }
      }
      console.log(`[人设进化] 完成，共处理 ${processed}/${combos.length} 个用户`)
    } catch (e) { console.error('[人设进化] 任务失败:', e.message) }
  })
  console.log('[人设进化调度] 已配置，每周一凌晨 3 点执行')
}

// ========== 启动 ==========
async function main() {
  console.log('正在连接 MySQL...')
  await initDB()
  await initMemoryTables()

  const savedBots = await dbGetBots()
  console.log(`从数据库加载 ${savedBots.length} 个 Bot`)
  for (const data of savedBots) {
    const bot = new BotInstance(data)
    botsMap.set(bot.id, bot)
    bot.start().catch(e => console.log(`[${bot.name}] 启动失败: ${e?.message}`))
  }

  const PORT = process.env.PORT ?? 8849
  app.listen(PORT, () => {
    console.log(`\n[定时调度器] 服务已在 ${PORT} 端口启动`)
    initScheduler()
  })
}

main().catch(e => { console.error('启动失败:', e.message); process.exit(1) })
