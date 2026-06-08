/**
 * test-memory.mjs
 * 记忆与人设进化系统 功能测试脚本
 *
 * 用法：
 *   1. 先启动后端 server:  node server.js
 *   2. 运行测试:           node test-memory.mjs
 *
 * 测试范围：
 *   - 三张表是否存在
 *   - tb_base_role CRUD（初始化、追加、覆盖）
 *   - tb_long_memory CRUD（插入、关键词搜索、回退最新、删除）
 *   - tb_chat_record CRUD（插入、按时间范围查询）
 *   - 三段 Prompt 拼接逻辑（单元模拟）
 *   - 记忆提取过滤规则（无效内容跳过）
 *   - Token 阈值裁剪逻辑
 *   - HTTP API 端点（需要 server 在 8849 运行）
 */

import mysql from 'mysql2/promise'
import { readFileSync } from 'fs'

// ========= 颜色输出 =========
const G = (s) => `\x1b[32m${s}\x1b[0m`  // 绿
const R = (s) => `\x1b[31m${s}\x1b[0m`  // 红
const Y = (s) => `\x1b[33m${s}\x1b[0m`  // 黄
const B = (s) => `\x1b[36m${s}\x1b[0m`  // 青

let pass = 0, fail = 0, skip = 0

function ok(label) { console.log(G('  ✓ ') + label); pass++ }
function ko(label, err) { console.log(R('  ✗ ') + label + (err ? R(' — ' + err) : '')); fail++ }
function sk(label) { console.log(Y('  - ') + label + Y(' (跳过)'));  skip++ }

function section(title) {
  console.log('\n' + B('━━ ' + title + ' ━━'))
}

function assert(cond, label, err) {
  cond ? ok(label) : ko(label, err)
}

// ========= 读取 DB 配置 =========
const cfg = JSON.parse(readFileSync('./config.json', 'utf8'))
const dbCfg = { ...cfg.mysql, multipleStatements: true, dateStrings: true }

// 测试专用 bot_id / user_id，避免污染真实数据
const BOT_ID  = '__test_bot__'
const USER_ID = '__test_user__'
const API_BASE = `http://localhost:8849`

// ========= 工具：登录获取 token =========
async function getAdminToken() {
  // 直接从 DB 查第一个 admin 用户
  const db = await mysql.createConnection(dbCfg)
  const [rows] = await db.query("SELECT username FROM users WHERE role='admin' LIMIT 1")
  await db.end()
  if (!rows[0]) return null

  const res = await fetch(`${API_BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: rows[0].username, password: 'admin' }), // 默认密码
  }).then(r => r.json()).catch(() => null)
  return res?.token ?? null
}

// ========= 主流程 =========
async function runTests() {
  console.log(B('\n╔══════════════════════════════════════╗'))
  console.log(B('║  记忆系统功能测试  test-memory.mjs   ║'))
  console.log(B('╚══════════════════════════════════════╝'))

  let db
  try {
    db = await mysql.createConnection(dbCfg)
    ok('数据库连接成功')
  } catch (e) {
    ko('数据库连接失败', e.message)
    console.log(R('\n无法连接数据库，终止测试。'))
    process.exit(1)
  }

  // ─── Section 1: 表存在性检查（不存在则自动建表，让测试独立运行）───
  section('1. 数据库表存在性')

  await db.query(`CREATE TABLE IF NOT EXISTS tb_base_role (
    id INT AUTO_INCREMENT PRIMARY KEY,
    bot_id VARCHAR(64) NOT NULL,
    user_id VARCHAR(128) NOT NULL,
    base_prompt TEXT NOT NULL,
    last_update DATE NULL,
    UNIQUE KEY uk_bot_user (bot_id, user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)

  await db.query(`CREATE TABLE IF NOT EXISTS tb_long_memory (
    id INT AUTO_INCREMENT PRIMARY KEY,
    bot_id VARCHAR(64) NOT NULL,
    user_id VARCHAR(128) NOT NULL,
    content VARCHAR(500) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    KEY idx_bu (bot_id, user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)

  await db.query(`CREATE TABLE IF NOT EXISTS tb_chat_record (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    bot_id VARCHAR(64) NOT NULL,
    user_id VARCHAR(128) NOT NULL,
    role VARCHAR(16) NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    KEY idx_bu_time (bot_id, user_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)

  for (const tbl of ['tb_base_role', 'tb_long_memory', 'tb_chat_record']) {
    const [rows] = await db.query(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?`,
      [tbl]
    )
    assert(rows.length > 0, `表 ${tbl} 已创建`)
  }

  // 清理上次测试残留
  await db.query(`DELETE FROM tb_base_role   WHERE bot_id=? AND user_id=?`, [BOT_ID, USER_ID])
  await db.query(`DELETE FROM tb_long_memory WHERE bot_id=? AND user_id=?`, [BOT_ID, USER_ID])
  await db.query(`DELETE FROM tb_chat_record WHERE bot_id=? AND user_id=?`, [BOT_ID, USER_ID])

  // ─── Section 2: tb_base_role ───
  section('2. tb_base_role — 专属成长人设')

  // 2-1 初始化（INSERT IGNORE）
  await db.query(
    `INSERT IGNORE INTO tb_base_role (bot_id, user_id, base_prompt) VALUES (?, ?, '')`,
    [BOT_ID, USER_ID]
  )
  const [r1] = await db.query(`SELECT * FROM tb_base_role WHERE bot_id=? AND user_id=?`, [BOT_ID, USER_ID])
  assert(r1.length === 1 && r1[0].base_prompt === '', '初始化写入空人设')

  // 2-2 重复 INSERT IGNORE 不报错
  await db.query(
    `INSERT IGNORE INTO tb_base_role (bot_id, user_id, base_prompt) VALUES (?, ?, 'should-not-overwrite')`,
    [BOT_ID, USER_ID]
  )
  const [r2] = await db.query(`SELECT base_prompt FROM tb_base_role WHERE bot_id=? AND user_id=?`, [BOT_ID, USER_ID])
  assert(r2[0].base_prompt === '', '重复 INSERT IGNORE 不覆盖原有内容')

  // 2-3 追加内容（CONCAT）
  await db.query(
    `UPDATE tb_base_role SET base_prompt=CONCAT(base_prompt, ?) WHERE bot_id=? AND user_id=?`,
    ['\n【口头禅】诶呀我去、哈哈哈哈', BOT_ID, USER_ID]
  )
  const [r3] = await db.query(`SELECT base_prompt FROM tb_base_role WHERE bot_id=? AND user_id=?`, [BOT_ID, USER_ID])
  assert(r3[0].base_prompt.includes('口头禅'), '追加内容 CONCAT 成功')

  // 2-4 再次追加，原内容保留
  await db.query(
    `UPDATE tb_base_role SET base_prompt=CONCAT(base_prompt, ?) WHERE bot_id=? AND user_id=?`,
    ['\n【小习惯】聊天喜欢发短句', BOT_ID, USER_ID]
  )
  const [r4] = await db.query(`SELECT base_prompt FROM tb_base_role WHERE bot_id=? AND user_id=?`, [BOT_ID, USER_ID])
  assert(r4[0].base_prompt.includes('口头禅') && r4[0].base_prompt.includes('小习惯'), '多次追加，原有内容不丢失')

  // 2-5 覆盖写（SET）
  await db.query(
    `UPDATE tb_base_role SET base_prompt=? WHERE bot_id=? AND user_id=?`,
    ['手动覆盖的人设', BOT_ID, USER_ID]
  )
  const [r5] = await db.query(`SELECT base_prompt FROM tb_base_role WHERE bot_id=? AND user_id=?`, [BOT_ID, USER_ID])
  assert(r5[0].base_prompt === '手动覆盖的人设', '手动覆盖写入正确')

  // 2-6 last_update 更新
  const today = new Date().toISOString().slice(0, 10)
  await db.query(
    `UPDATE tb_base_role SET last_update=? WHERE bot_id=? AND user_id=?`,
    [today, BOT_ID, USER_ID]
  )
  const [r6] = await db.query(`SELECT last_update FROM tb_base_role WHERE bot_id=? AND user_id=?`, [BOT_ID, USER_ID])
  assert(String(r6[0].last_update).slice(0, 10) === today, 'last_update 写入正确')

  // ─── Section 3: tb_long_memory ───
  section('3. tb_long_memory — 长期记忆')

  // 3-1 插入单条
  await db.query(
    `INSERT INTO tb_long_memory (bot_id, user_id, content) VALUES (?, ?, ?)`,
    [BOT_ID, USER_ID, '用户生日是3月15日']
  )
  await db.query(
    `INSERT INTO tb_long_memory (bot_id, user_id, content) VALUES (?, ?, ?)`,
    [BOT_ID, USER_ID, '用户喜欢打篮球']
  )
  await db.query(
    `INSERT INTO tb_long_memory (bot_id, user_id, content) VALUES (?, ?, ?)`,
    [BOT_ID, USER_ID, '用户每周日不上班']
  )
  await db.query(
    `INSERT INTO tb_long_memory (bot_id, user_id, content) VALUES (?, ?, ?)`,
    [BOT_ID, USER_ID, '用户的昵称是小马']
  )

  const [m0] = await db.query(`SELECT COUNT(*) as cnt FROM tb_long_memory WHERE bot_id=? AND user_id=?`, [BOT_ID, USER_ID])
  assert(m0[0].cnt === 4, '插入4条记忆，数量正确')

  // 3-2 关键词匹配
  const kw = '%生日%'
  const [m1] = await db.query(
    `SELECT id, content FROM tb_long_memory WHERE bot_id=? AND user_id=? AND content LIKE ? ORDER BY created_at DESC LIMIT 5`,
    [BOT_ID, USER_ID, kw]
  )
  assert(m1.length === 1 && m1[0].content.includes('生日'), '关键词"生日"匹配正确')

  // 3-3 未匹配关键词时回退到最新 5 条
  const kw2 = '%不存在的关键词xyz%'
  const [m2a] = await db.query(
    `SELECT id, content FROM tb_long_memory WHERE bot_id=? AND user_id=? AND content LIKE ? LIMIT 5`,
    [BOT_ID, USER_ID, kw2]
  )
  let fallback = m2a
  if (m2a.length === 0) {
    const [m2b] = await db.query(
      `SELECT id, content FROM tb_long_memory WHERE bot_id=? AND user_id=? ORDER BY created_at DESC LIMIT 5`,
      [BOT_ID, USER_ID]
    )
    fallback = m2b
  }
  assert(fallback.length === 4, '无匹配时回退到最新记录（4条）')

  // 3-4 删除单条
  const delId = m1[0].id
  await db.query(`DELETE FROM tb_long_memory WHERE id=?`, [delId])
  const [m3] = await db.query(`SELECT COUNT(*) as cnt FROM tb_long_memory WHERE bot_id=? AND user_id=?`, [BOT_ID, USER_ID])
  assert(m3[0].cnt === 3, '删除单条记忆后数量正确（3条）')

  // 3-5 content 超 500 字截断（模拟）
  const longContent = 'A'.repeat(600)
  const truncated = longContent.slice(0, 500)
  await db.query(
    `INSERT INTO tb_long_memory (bot_id, user_id, content) VALUES (?, ?, ?)`,
    [BOT_ID, USER_ID, truncated]
  )
  const [m4] = await db.query(
    `SELECT content FROM tb_long_memory WHERE bot_id=? AND user_id=? AND content LIKE 'AAAA%'`,
    [BOT_ID, USER_ID]
  )
  assert(m4[0]?.content.length === 500, 'content 截断至 500 字正常写入')

  // ─── Section 4: tb_chat_record ───
  section('4. tb_chat_record — 全量聊天记录')

  const msgs = [
    { role: 'user',      content: '你好啊' },
    { role: 'assistant', content: '你好，宝贝～' },
    { role: 'user',      content: '今天吃啥' },
    { role: 'assistant', content: '炒饭怎么样哈哈' },
    { role: 'user',      content: '好的' },
    { role: 'assistant', content: '那我帮你点！' },
  ]
  for (const m of msgs) {
    await db.query(
      `INSERT INTO tb_chat_record (bot_id, user_id, role, content) VALUES (?, ?, ?, ?)`,
      [BOT_ID, USER_ID, m.role, m.content]
    )
  }

  const [cr1] = await db.query(
    `SELECT COUNT(*) as cnt FROM tb_chat_record WHERE bot_id=? AND user_id=?`,
    [BOT_ID, USER_ID]
  )
  assert(cr1[0].cnt === 6, '插入6条全量记录，数量正确')

  // 按时间范围查询（取过去 7 天）
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000)
  const [cr2] = await db.query(
    `SELECT role, content FROM tb_chat_record WHERE bot_id=? AND user_id=? AND created_at>? ORDER BY created_at ASC`,
    [BOT_ID, USER_ID, since]
  )
  assert(cr2.length === 6, '按时间范围查询返回正确数量')
  assert(cr2[0].role === 'user' && cr2[1].role === 'assistant', '角色顺序正确（user/assistant 交替）')

  // 过滤短句（模拟人设进化的数据清洗）
  // '你好啊'(3字) 和 '好的'(2字) 都 < 4，两条会被过滤
  const filtered = cr2.filter(r => r.content.length >= 4)
  assert(filtered.length === 4, '过滤长度 < 4 的短句（“好的” 2字、“你好啊” 3字被过滤，剩余 4 条）')

  // ─── Section 5: 三段 Prompt 拼接逻辑（单元模拟） ───
  section('5. 三段 Prompt 拼接逻辑')

  const BASE = '你是AI女友盼盼'
  const PERSONA_TPL  = '说话短句，爱撒娇'
  const CUSTOM       = '偶尔用四川方言'
  const BASE_ROLE_PROMPT = '\n【2025-01-06新增习惯】口头禅：诶呀我去'
  const MEMORIES = ['用户生日3月15日', '用户昵称小马']
  const CTX = [
    { role: 'user', content: '吃饭没' },
    { role: 'assistant', content: '刚吃～' },
  ]

  const parts = [BASE]
  parts.push('\n【人设模板】\n' + PERSONA_TPL)
  parts.push('\n【自定义补充】\n' + CUSTOM)
  parts.push('\n【专属成长记忆】\n' + BASE_ROLE_PROMPT)
  parts.push('\n【关于TA的记忆】\n' + MEMORIES.map(m => '- ' + m).join('\n'))
  const systemPrompt = parts.join('\n')

  assert(systemPrompt.startsWith(BASE), '第一段：BASE_PERSONA 置顶')
  assert(systemPrompt.includes('人设模板'), '第一段：人设模板已注入')
  assert(systemPrompt.includes('专属成长记忆'), '第一段：专属成长记忆已注入')
  assert(systemPrompt.includes('关于TA的记忆'), '第二段：长期记忆已注入')
  assert(systemPrompt.indexOf('关于TA的记忆') > systemPrompt.indexOf('专属成长记忆'), '第二段在第一段之后')

  const totalLen = systemPrompt.length + CTX.reduce((s, m) => s + m.content.length, 0)
  assert(totalLen > 0 && totalLen < 2800, `Token 总长度合理（${totalLen} 字）`)

  // ─── Section 6: Token 超限裁剪逻辑 ───
  section('6. Token 超限裁剪逻辑')

  // 模拟 totalLen > 2800 时触发裁剪
  const bigBase = 'A'.repeat(2500)
  const bigCtx  = Array.from({ length: 20 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: '这是第' + i + '条消息内容，用于支起上下文长度测试，内容要多一些',
  }))
  const bigTotal = bigBase.length + bigCtx.reduce((s, m) => s + m.content.length, 0)
  const shouldTrim = bigTotal > 2800 && bigCtx.length > 8
  assert(shouldTrim, `触发裁剪条件：总长 ${bigTotal} > 2800 且长度 ${bigCtx.length} > 8`)

  // 裁剪4条
  const ctx2 = [...bigCtx]
  const old = ctx2.splice(0, 4)
  assert(old.length === 4,     '裁剪 4 条最旧消息')
  assert(ctx2.length === 16,   '裁剪后剩余 16 条')

  // ─── Section 7: 记忆提取过滤规则 ───
  section('7. 记忆提取过滤规则（AI 结果校验）')

  // 模拟 callAI 返回值的过滤逻辑
  const testCases = [
    { input: '',         shouldStore: false, label: '空字符串不入库' },
    { input: '   ',      shouldStore: false, label: '纯空格不入库' },
    { input: '无',       shouldStore: false, label: '"无"不入库' },
    { input: '无\n',     shouldStore: false, label: '"无\\n"不入库' },
    { input: 'ok',       shouldStore: false, label: '长度<=3不入库（"ok"）' },
    { input: '用户生日是8月8日', shouldStore: true, label: '有效信息入库' },
    { input: '用户喜欢打游戏',   shouldStore: true, label: '有效爱好入库' },
  ]

  for (const tc of testCases) {
    const trimmed = tc.input?.trim()
    const willStore = !!(trimmed && trimmed !== '无' && trimmed.length > 3)
    assert(willStore === tc.shouldStore, tc.label)
  }

  // ─── Section 8: API 端点测试（需要 server 运行）───
  section('8. HTTP API 端点测试')

  // 先检查 server 是否在线
  let serverUp = false
  let token = null
  try {
    const hc = await fetch(`${API_BASE}/api/bots`, { signal: AbortSignal.timeout(2000) })
    serverUp = hc.status !== undefined
  } catch {}

  if (!serverUp) {
    sk('Server 未运行，跳过 API 测试')
    sk('GET /api/memory-users')
    sk('GET /api/memory/:botId/:userId')
    sk('PUT /api/base-role/:botId/:userId')
    sk('GET /api/base-role/:botId/:userId')
    sk('DELETE /api/memory/:id')
  } else {
    ok('Server 在线')
    // 获取 admin token（尝试常见密码）
    for (const pwd of ['admin', 'admin123', '123456', 'password']) {
      try {
        const [uRows] = await db.query("SELECT username FROM users WHERE role='admin' LIMIT 1")
        if (!uRows[0]) break
        const lr = await fetch(`${API_BASE}/api/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: uRows[0].username, password: pwd }),
        }).then(r => r.json())
        if (lr?.token) { token = lr.token; break }
      } catch {}
    }

    if (!token) {
      sk('无法获取 admin token，跳过需鉴权 API 测试')
    } else {
      ok(`获取 admin token 成功`)
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }

      // 8-1 GET /api/memory-users
      try {
        const r = await fetch(`${API_BASE}/api/memory-users`, { headers })
        const d = await r.json()
        assert(r.ok && Array.isArray(d), `GET /api/memory-users 返回数组（${d.length} 条）`)
      } catch (e) { ko('GET /api/memory-users', e.message) }

      // 先插入测试记忆供后续 API 测试
      await db.query(`DELETE FROM tb_long_memory WHERE bot_id=? AND user_id=?`, [BOT_ID, USER_ID])
      await db.query(
        `INSERT INTO tb_long_memory (bot_id, user_id, content) VALUES (?, ?, ?)`,
        [BOT_ID, USER_ID, 'API测试记忆条目']
      )
      const [apiMem] = await db.query(
        `SELECT id FROM tb_long_memory WHERE bot_id=? AND user_id=? ORDER BY id DESC LIMIT 1`,
        [BOT_ID, USER_ID]
      )
      const memId = apiMem[0]?.id

      // 8-2 GET /api/memory/:botId/:userId
      try {
        const r = await fetch(`${API_BASE}/api/memory/${BOT_ID}/${USER_ID}`, { headers })
        const d = await r.json()
        assert(r.ok && Array.isArray(d), `GET /api/memory/:botId/:userId 返回数组（${d.length} 条）`)
      } catch (e) { ko('GET /api/memory/:botId/:userId', e.message) }

      // 8-3 PUT /api/base-role/:botId/:userId
      try {
        const r = await fetch(`${API_BASE}/api/base-role/${BOT_ID}/${USER_ID}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ base_prompt: 'API写入的人设内容' }),
        })
        const d = await r.json()
        assert(r.ok && d.ok, 'PUT /api/base-role 保存成功')
      } catch (e) { ko('PUT /api/base-role', e.message) }

      // 8-4 GET /api/base-role/:botId/:userId
      try {
        const r = await fetch(`${API_BASE}/api/base-role/${BOT_ID}/${USER_ID}`, { headers })
        const d = await r.json()
        assert(r.ok && d.base_prompt === 'API写入的人设内容', 'GET /api/base-role 读取与写入一致')
      } catch (e) { ko('GET /api/base-role', e.message) }

      // 8-5 DELETE /api/memory/:id
      if (memId) {
        try {
          const r = await fetch(`${API_BASE}/api/memory/${memId}`, { method: 'DELETE', headers })
          const d = await r.json()
          assert(r.ok && d.ok, `DELETE /api/memory/${memId} 删除成功`)
          // 验证已删除
          const [check] = await db.query(`SELECT id FROM tb_long_memory WHERE id=?`, [memId])
          assert(check.length === 0, '删除后数据库确认记录不存在')
        } catch (e) { ko('DELETE /api/memory/:id', e.message) }
      } else {
        sk('DELETE /api/memory/:id（无可删除记录）')
      }

      // 8-6 无效 PUT（缺 base_prompt）
      try {
        const r = await fetch(`${API_BASE}/api/base-role/${BOT_ID}/${USER_ID}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({}),
        })
        assert(!r.ok && r.status === 400, 'PUT 缺少 base_prompt 返回 400')
      } catch (e) { ko('PUT 参数校验', e.message) }
    }
  }

  // ─── 清理测试数据 ───
  section('9. 清理测试数据')
  try {
    await db.query(`DELETE FROM tb_base_role   WHERE bot_id=?`, [BOT_ID])
    await db.query(`DELETE FROM tb_long_memory WHERE bot_id=?`, [BOT_ID])
    await db.query(`DELETE FROM tb_chat_record WHERE bot_id=?`, [BOT_ID])
    ok('测试数据清理完成')
  } catch (e) {
    ko('测试数据清理失败', e.message)
  }

  await db.end()

  // ─── 汇总 ───
  console.log('\n' + B('━━ 测试结果汇总 ━━'))
  console.log(`  ${G('通过')}：${pass}  |  ${R('失败')}：${fail}  |  ${Y('跳过')}：${skip}`)

  if (fail === 0) {
    console.log(G('\n  ✓ 全部测试通过！\n'))
    process.exit(0)
  } else {
    console.log(R(`\n  ✗ 有 ${fail} 项测试失败，请检查上方输出。\n`))
    process.exit(1)
  }
}

runTests().catch(e => {
  console.error(R('测试执行异常：' + e.message))
  process.exit(1)
})
