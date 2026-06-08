<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { Plus, Search, Bot as BotIcon, BookOpen, Cpu, Users, LogOut, Sparkles, Menu, X, Package, Settings, ShoppingCart, Gift, CreditCard, Clock, Brain } from 'lucide-vue-next'
import { apiUrl } from './lib/api'
import StatCard from './components/StatCard.vue'
import BotCard, { type Bot, type BotStatus } from './components/BotCard.vue'
import CreateBotModal from './components/CreateBotModal.vue'
import QrCodeModal from './components/QrCodeModal.vue'
import BotDetailDrawer from './components/BotDetailDrawer.vue'
import PersonasModal from './components/PersonasModal.vue'
import AIProvidersModal from './components/AIProvidersModal.vue'
import UsersModal from './components/UsersModal.vue'
import PromptTemplatesModal from './components/PromptTemplatesModal.vue'
import PackagesModal from './components/PackagesModal.vue'
import SystemConfigModal from './components/SystemConfigModal.vue'
import WxPayConfigsModal from './components/WxPayConfigsModal.vue'
import ScheduledMsgsModal from './components/ScheduledMsgsModal.vue'
import MemoryMgrModal from './components/MemoryMgrModal.vue'
import QuotaShopModal from './components/QuotaShopModal.vue'
import LoginPage from './components/LoginPage.vue'

// -------- Auth --------
const authToken     = ref(localStorage.getItem('clawbot_token') ?? '')
const authUsername  = ref(localStorage.getItem('clawbot_username') ?? '')
const authRole      = ref(localStorage.getItem('clawbot_role') ?? '')
const authQuota     = ref(Number(localStorage.getItem('clawbot_quota') ?? 0))
const authInviteCode  = ref(localStorage.getItem('clawbot_invite_code') ?? '')
const authInviteCount = ref(Number(localStorage.getItem('clawbot_invite_count') ?? 0))
const copiedInvite    = ref(false)
const isLoggedIn    = computed(() => !!authToken.value)

function apiFetch(url: string, init: RequestInit = {}) {
  return fetch(apiUrl(url), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(authToken.value ? { Authorization: `Bearer ${authToken.value}` } : {}),
      ...(init.headers as object ?? {}),
    },
  })
}

function handleLogin({ token, username, role, quota, inviteCode, inviteCount }: { token: string; username: string; role: string; quota?: number; inviteCode?: string; inviteCount?: number }) {
  authToken.value       = token
  authUsername.value    = username
  authRole.value        = role
  authQuota.value       = quota ?? 0
  authInviteCode.value  = inviteCode ?? ''
  authInviteCount.value = inviteCount ?? 0
  localStorage.setItem('clawbot_token',        token)
  localStorage.setItem('clawbot_username',     username)
  localStorage.setItem('clawbot_role',         role)
  localStorage.setItem('clawbot_quota',        String(quota ?? 0))
  localStorage.setItem('clawbot_invite_code',  inviteCode ?? '')
  localStorage.setItem('clawbot_invite_count', String(inviteCount ?? 0))
}

async function handleLogout() {
  try { await apiFetch('/api/auth/logout', { method: 'POST' }) } catch {}
  authToken.value       = ''
  authUsername.value    = ''
  authRole.value        = ''
  authQuota.value       = 0
  authInviteCode.value  = ''
  authInviteCount.value = 0
  localStorage.removeItem('clawbot_token')
  localStorage.removeItem('clawbot_username')
  localStorage.removeItem('clawbot_role')
  localStorage.removeItem('clawbot_quota')
  localStorage.removeItem('clawbot_invite_code')
  localStorage.removeItem('clawbot_invite_count')
  bots.value = []
}

async function verifySession() {
  if (!authToken.value) return
  try {
    const res = await apiFetch('/api/auth/me')
    if (res.status === 401) {
      authToken.value = ''; authUsername.value = ''; authRole.value = ''
      localStorage.removeItem('clawbot_token')
      localStorage.removeItem('clawbot_username')
      localStorage.removeItem('clawbot_role')
    } else {
      const data = await res.json()
      authQuota.value       = data.quota ?? 0
      authInviteCode.value  = data.inviteCode ?? ''
      authInviteCount.value = data.inviteCount ?? 0
      localStorage.setItem('clawbot_quota',        String(data.quota ?? 0))
      localStorage.setItem('clawbot_invite_code',  data.inviteCode ?? '')
      localStorage.setItem('clawbot_invite_count', String(data.inviteCount ?? 0))
    }
  } catch {}
}

// -------- emoji --------
const emojiPool = ['🤖','✨','📊','🌍','💻','📝','🦊','🐱','🚀','💡','🎯','🔥']
function idToEmoji(id: string) {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return emojiPool[h % emojiPool.length]
}

function mapStatus(s: string): BotStatus {
  if (s === 'pending_qr') return 'scanning'
  if (s === 'offline')    return 'stopped'
  return s as BotStatus
}

function fmtDuration(loginTime: number | null): string {
  if (!loginTime) return '—'
  const sec = Math.floor((Date.now() - loginTime) / 1000)
  const h   = Math.floor(sec / 3600)
  const m   = Math.floor((sec % 3600) / 60)
  if (h >= 48) return `${Math.floor(h / 24)}d ${h % 24}h`
  if (h > 0)   return `${h}h ${m}m`
  return `${m}m`
}

// -------- 响应式状态 --------
const bots               = ref<Bot[]>([])
const query              = ref('')
const filter             = ref<BotStatus | 'all'>('all')
const createOpen         = ref(false)
const qrBot              = ref<Bot | null>(null)
const detailBot          = ref<Bot | null>(null)
const personasOpen       = ref(false)
const aiProvidersOpen    = ref(false)
const usersOpen          = ref(false)
const promptTplOpen      = ref(false)
const packagesOpen       = ref(false)
const systemConfigOpen   = ref(false)
const wxPayConfigsOpen   = ref(false)
const scheduledMsgsOpen  = ref(false)
const memoryMgrOpen      = ref(false)
const quotaShopOpen      = ref(false)
const menuOpen           = ref(false)   // 手机端汉堡菜单

function openMenu(fn: () => void) {
  menuOpen.value = false
  fn()
}

// -------- API 轮询 --------
async function fetchBots() {
  if (!isLoggedIn.value) return
  try {
    const res = await apiFetch('/api/bots')
    if (res.status === 401) { await handleLogout(); return }
    const raw: any[] = await res.json()
    bots.value = raw.map(b => ({
      id:         b.id,
      name:       b.name,
      emoji:      idToEmoji(b.id),
      status:     mapStatus(b.status),
      persona:    b.persona || '（未设置人设）',
      onlineTime: fmtDuration(b.loginTime),
      qrcodeUrl:  b.qrcodeUrl ?? null,
    }))
    if (qrBot.value) {
      const live = bots.value.find(b => b.id === qrBot.value!.id)
      if (live?.status === 'active') setTimeout(() => { qrBot.value = null }, 1200)
      else if (live) qrBot.value = { ...live }
    }
  } catch {}
}

let pollTimer: ReturnType<typeof setInterval>
onMounted(async () => {
  await verifySession()
  fetchBots()
  pollTimer = setInterval(fetchBots, 2000)

  // 处理微信 OAuth 回调中的 code
  if (isLoggedIn.value) {
    const params = new URLSearchParams(window.location.search)
    const code   = params.get('code')
    const state  = params.get('state')
    if (code && state === 'pay') {
      try {
        const res  = await apiFetch('/api/wx-oauth/exchange', {
          method: 'POST', body: JSON.stringify({ code }),
        })
        const data = await res.json()
        if (data.openid) localStorage.setItem('wx_openid', data.openid)
      } catch {}
      // 清理 URL 中的 code 参数
      const cleanUrl = window.location.pathname + window.location.hash
      window.history.replaceState({}, '', cleanUrl)
      // 自动打开购买额度弹窗
      setTimeout(() => { quotaShopOpen.value = true }, 300)
    }
  }
})
onUnmounted(() => clearInterval(pollTimer))

// -------- 统计 --------
const stats = computed(() => ({
  total:    bots.value.length,
  active:   bots.value.filter(b => b.status === 'active').length,
  scanning: bots.value.filter(b => b.status === 'scanning' || b.status === 'reconnecting').length,
  stopped:  bots.value.filter(b => b.status === 'stopped'  || b.status === 'expired').length,
}))

const filtered = computed(() => bots.value.filter(b => {
  const q = query.value.trim().toLowerCase()
  if (q && !b.name.toLowerCase().includes(q) && !b.persona.toLowerCase().includes(q)) return false
  if (filter.value !== 'all' && b.status !== filter.value) return false
  return true
}))

// -------- 操作 --------
async function handleCreate({ name, persona, personaId, gender }: { name: string; persona: string; personaId: number | null; gender: string }) {
  const res  = await apiFetch('/api/bots', {
    method: 'POST',
    body: JSON.stringify({ name, persona, personaId, gender }),
  })
  const data = await res.json()
  if (!res.ok) { alert(data.error ?? '创建失败'); return }
  createOpen.value = false
  await fetchBots()
  const newBot = bots.value.find(b => b.id === data.id)
  if (newBot) setTimeout(() => { qrBot.value = { ...newBot, qrcodeUrl: data.qrcodeUrl } }, 200)
}

async function handleRestart(bot: Bot) {
  await apiFetch(`/api/bots/${bot.id}/reconnect`, { method: 'POST' })
  await fetchBots()
  const live = bots.value.find(b => b.id === bot.id)
  if (live?.qrcodeUrl) qrBot.value = { ...live }
}

async function handleDelete(bot: Bot) {
  if (!confirm(`确定要删除 Bot「${bot.name}」吗？`)) return
  await apiFetch(`/api/bots/${bot.id}`, { method: 'DELETE' })
  if (qrBot.value?.id    === bot.id) qrBot.value    = null
  if (detailBot.value?.id === bot.id) detailBot.value = null
  await fetchBots()
}

async function handleSave({ id, persona }: { id: string; persona: string }) {
  bots.value = bots.value.map(b => b.id === id ? { ...b, persona } : b)
}

function handleQuotaUpdated(q: number) {
  authQuota.value = q
  localStorage.setItem('clawbot_quota', String(q))
}

async function copyInviteCode() {
  if (!authInviteCode.value) return
  try {
    await navigator.clipboard.writeText(authInviteCode.value)
  } catch {
    const el = document.createElement('input')
    el.value = authInviteCode.value
    document.body.appendChild(el)
    el.select()
    document.execCommand('copy')
    document.body.removeChild(el)
  }
  copiedInvite.value = true
  setTimeout(() => { copiedInvite.value = false }, 2000)
}
</script>

<template>
  <LoginPage v-if="!isLoggedIn" @login="handleLogin" />

  <div v-else class="min-h-screen w-full bg-[#F7F8FA]"
    style='font-family:"Microsoft YaHei","PingFang SC",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1D2129;'>

    <!-- ===== Header ===== -->
    <header class="sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-[#F2F3F5]">
      <div class="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-10 h-[56px] flex items-center justify-between gap-2">

        <!-- Logo -->
        <div class="flex items-center gap-2 shrink-0">
          <div class="w-8 h-8 rounded-[9px] flex items-center justify-center text-white"
               style="background:linear-gradient(135deg,#4080FF,#5B8DEF)">
            <BotIcon :size="16" />
          </div>
          <div class="hidden xs:block">
            <div class="text-[14px] font-medium" style="color:#1D2129">微信 ClawBot</div>
            <div class="text-[11px] text-[#86909C] -mt-0.5 hidden sm:block">多 Bot 管理面板</div>
          </div>
        </div>

        <!-- 桌面端：管理按鈕组 (sm+) -->
        <div v-if="authRole === 'admin'" class="hidden sm:flex items-center gap-1.5">
          <button class="lib-btn" @click="usersOpen = true">
            <Users :size="14" /> 用户管理
          </button>
          <button class="lib-btn" @click="aiProvidersOpen = true">
            <Cpu :size="14" /> AI 配置
          </button>
          <button class="lib-btn" @click="personasOpen = true">
            <BookOpen :size="14" /> 人设库
          </button>
          <button class="lib-btn" @click="promptTplOpen = true">
            <Sparkles :size="14" /> 提示词库
          </button>
          <button class="lib-btn" @click="packagesOpen = true">
            <Package :size="14" /> 套餐管理
          </button>
          <button class="lib-btn" @click="wxPayConfigsOpen = true">
            <CreditCard :size="14" /> 支付配置
          </button>
          <button class="lib-btn" @click="scheduledMsgsOpen = true">
            <Clock :size="14" /> 定时消息
          </button>
          <button class="lib-btn" @click="memoryMgrOpen = true">
            <Brain :size="14" /> 记忆管理
          </button>
          <button class="lib-btn" @click="systemConfigOpen = true">
            <Settings :size="14" /> 系统设置
          </button>
        </div>

        <!-- 右侧：用户信息 + 操作 -->
        <div class="flex items-center gap-1.5 shrink-0">
        <!-- 额度显示（普通用户） -->
          <button v-if="authRole !== 'admin'" class="quota-badge-new" @click="quotaShopOpen = true">
            <span class="qb-label">额度</span>
            <span class="qb-num">{{ authQuota }}</span>
            <span class="qb-cta">充値 +</span>
          </button>
          <span v-else class="hidden sm:inline text-[12px] text-[#86909C]">Admin 额度: {{ authQuota }}</span>
          <!-- 用户名 + 角色（仅 sm+ 显示用户名） -->
          <span class="hidden sm:inline text-[13px] text-[#4E5969]">{{ authUsername }}</span>
          <span class="role-tag" :class="authRole">{{ authRole === 'admin' ? '管理员' : '用户' }}</span>
        
          <!-- 手机端汉堡菜单按鈕（admin 才显示） -->
          <button v-if="authRole === 'admin'"
            class="menu-btn sm:hidden"
            @click="menuOpen = !menuOpen">
            <X v-if="menuOpen" :size="18" />
            <Menu v-else :size="18" />
          </button>
        
          <!-- 登出 -->
          <button class="logout-btn" title="退出登录" @click="handleLogout">
            <LogOut :size="15" />
          </button>
        </div>
      </div>

      <!-- 手机端下拉菜单 -->
      <Transition name="menu-drop">
        <div v-if="menuOpen && authRole === 'admin'"
          class="sm:hidden border-t border-[#F2F3F5] bg-white px-4 py-3 grid grid-cols-2 gap-2">
          <button class="mobile-menu-item" @click="openMenu(() => usersOpen = true)">
            <Users :size="16" style="color:#4080FF" />
            <span>用户管理</span>
          </button>
          <button class="mobile-menu-item" @click="openMenu(() => aiProvidersOpen = true)">
            <Cpu :size="16" style="color:#4080FF" />
            <span>AI 配置</span>
          </button>
          <button class="mobile-menu-item" @click="openMenu(() => personasOpen = true)">
            <BookOpen :size="16" style="color:#4080FF" />
            <span>人设库</span>
          </button>
          <button class="mobile-menu-item" @click="openMenu(() => promptTplOpen = true)">
            <Sparkles :size="16" style="color:#7B61FF" />
            <span>提示词库</span>
          </button>
          <button class="mobile-menu-item" @click="openMenu(() => packagesOpen = true)">
            <Package :size="16" style="color:#4080FF" />
            <span>套餐管理</span>
          </button>
          <button class="mobile-menu-item" @click="openMenu(() => wxPayConfigsOpen = true)">
            <CreditCard :size="16" style="color:#4080FF" />
            <span>支付配置</span>
          </button>
          <button class="mobile-menu-item" @click="openMenu(() => scheduledMsgsOpen = true)">
            <Clock :size="16" style="color:#7B61FF" />
            <span>定时消息</span>
          </button>
          <button class="mobile-menu-item" @click="openMenu(() => memoryMgrOpen = true)">
            <Brain :size="16" style="color:#7B61FF" />
            <span>记忆管理</span>
          </button>
          <button class="mobile-menu-item" @click="openMenu(() => systemConfigOpen = true)">
            <Settings :size="16" style="color:#4E5969" />
            <span>系统设置</span>
          </button>
        </div>
      </Transition>
    </header>

    <!-- ===== Main ===== -->
    <main class="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-10 py-5 sm:py-8">

      <!-- 统计卡片 -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard variant="total"    :value="stats.total" />
        <StatCard variant="active"   :value="stats.active" />
        <StatCard variant="scanning" :value="stats.scanning" />
        <StatCard variant="stopped"  :value="stats.stopped" />
      </div>

      <!-- 邀请活动横幅（仅普通用户显示） -->
      <div v-if="authRole !== 'admin' && authInviteCode" class="invite-banner mt-4 sm:mt-5">
        <div class="invite-banner-left">
          <div class="invite-title">🎁 邀请好友，双方各得额度奖励</div>
          <div class="invite-desc">*每成功邀请一个好友注册，双方各得额外聊天额度</div>
          <div v-if="authInviteCount > 0" class="invite-count-badge">👥 已成功邀请 {{ authInviteCount }} 人</div>
        </div>
        <div class="invite-banner-right">
          <div class="invite-code-label">我的邀请码</div>
          <div class="invite-code-row">
            <span class="invite-code-text">{{ authInviteCode }}</span>
            <button class="invite-copy-btn" :class="{ copied: copiedInvite }" @click="copyInviteCode">
              {{ copiedInvite ? '✓ 已复制' : '复制' }}
            </button>
          </div>
        </div>
      </div>

      <!-- 工具栏 -->
      <div class="mt-5 sm:mt-6 flex flex-col sm:flex-row gap-2.5 sm:items-center">
        <!-- 搜索框 -->
        <div class="relative w-full sm:flex-1 sm:max-w-[400px]">
          <Search :size="15" class="absolute left-3 top-1/2 -translate-y-1/2 text-[#86909C]" />
          <input v-model="query" placeholder="搜索 Bot 名称或人设…"
            class="toolbar-input w-full" style="padding-left:34px;" />
        </div>
        <!-- 筛选 -->
        <select v-model="filter" class="toolbar-input w-full sm:w-[150px]">
          <option value="all">全部状态</option>
          <option value="active">运行中</option>
          <option value="scanning">等待扫码</option>
          <option value="reconnecting">重连中</option>
          <option value="expired">已过期</option>
          <option value="stopped">已停止</option>
        </select>
        <!-- 新建按钮 -->
        <button class="new-btn w-full sm:w-auto" @click="createOpen = true">
          <Plus :size="16" /> 新建 Bot
        </button>
      </div>

      <!-- Bot 列表 -->
      <div class="mt-5 sm:mt-6">
        <div v-if="filtered.length === 0"
          class="bg-white rounded-[12px] border border-[#F2F3F5] py-20 text-center">
          <div style="color:#1D2129">没有找到匹配的 Bot</div>
          <div class="text-[13px] text-[#86909C] mt-1">尝试调整搜索关键词或筛选条件</div>
        </div>
        <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
          <BotCard
            v-for="b in filtered" :key="b.id" :bot="b"
            @view="detailBot = $event"
            @restart="handleRestart"
            @delete="handleDelete"
          />
        </div>
      </div>
    </main>

    <!-- ===== Modals ===== -->
    <PersonasModal       :open="personasOpen"    @update:open="personasOpen = $event" />
    <AIProvidersModal    :open="aiProvidersOpen" @update:open="aiProvidersOpen = $event" />
    <UsersModal          :open="usersOpen"       :token="authToken" @update:open="usersOpen = $event" />
    <PromptTemplatesModal :open="promptTplOpen"  :token="authToken" @update:open="promptTplOpen = $event" />
    <PackagesModal       :open="packagesOpen"    :token="authToken" @update:open="packagesOpen = $event" />
    <SystemConfigModal   :open="systemConfigOpen" :token="authToken" @update:open="systemConfigOpen = $event" />
    <WxPayConfigsModal   :open="wxPayConfigsOpen" :token="authToken" @update:open="wxPayConfigsOpen = $event" />
    <ScheduledMsgsModal  :open="scheduledMsgsOpen" :token="authToken" @update:open="scheduledMsgsOpen = $event" />
    <MemoryMgrModal       :open="memoryMgrOpen"     :token="authToken" @update:open="memoryMgrOpen = $event" />
    <QuotaShopModal      :open="quotaShopOpen"   :token="authToken"
      @update:open="quotaShopOpen = $event"
      @quota-updated="handleQuotaUpdated"
    />
    <CreateBotModal      :open="createOpen"      :token="authToken"
      @update:open="createOpen = $event" @create="handleCreate" />
    <QrCodeModal         :open="!!qrBot"         :bot="qrBot"
      @update:open="(v) => !v && (qrBot = null)" @refresh="() => {}" />
    <BotDetailDrawer     :open="!!detailBot"     :bot="detailBot"  :token="authToken"
      @update:open="(v) => !v && (detailBot = null)" @save="handleSave" />
  </div>
</template>

<style scoped>
.toolbar-input {
  height:40px; padding:0 12px;
  background:#fff; border:1px solid #E5E6EB; border-radius:10px;
  font-size:14px; color:#1D2129; outline:none;
  transition:border-color .15s,box-shadow .15s;
}
.toolbar-input:focus { border-color:#4080FF; box-shadow:0 0 0 3px rgba(64,128,255,.15); }

.lib-btn {
  height:34px; padding:0 12px; border-radius:8px;
  background:#F7F8FA; color:#4E5969;
  border:1px solid #E5E6EB; cursor:pointer;
  display:inline-flex; align-items:center; gap:5px;
  font-size:13px; white-space:nowrap; transition:all .15s;
}
.lib-btn:hover { background:#EEF3FF; color:#4080FF; border-color:#C2D4FF; }

.new-btn {
  height:40px; padding:0 18px; border-radius:10px;
  background:#4080FF; color:#fff; border:none; cursor:pointer;
  display:inline-flex; align-items:center; justify-content:center; gap:6px;
  font-size:14px; font-weight:500;
  box-shadow:0 4px 14px rgba(64,128,255,.28);
  transition:background .15s,transform .1s;
}
.new-btn:hover  { background:#2D6FED; }
.new-btn:active { transform:translateY(1px); }

.role-tag {
  font-size:11px; font-weight:500; padding:2px 8px; border-radius:20px; white-space:nowrap;
}
.role-tag.admin { background:rgba(64,128,255,.12); color:#4080FF; }
.role-tag.user  { background:rgba(134,144,156,.12); color:#86909C; }

.quota-badge {
  display:inline-flex; align-items:center; gap:4px;
  height:26px; padding:0 10px; border-radius:20px;
  background:rgba(64,128,255,.10); color:#4080FF;
  border:1px solid rgba(64,128,255,.2);
  font-size:11px; font-weight:500; cursor:pointer; white-space:nowrap;
  transition:all .15s;
}
.quota-badge:hover { background:rgba(64,128,255,.18); }

/* 适度徽章新版 */
.quota-badge-new {
  display:inline-flex; align-items:center; gap:0;
  height:30px; border-radius:20px; overflow:hidden;
  border:none; cursor:pointer; white-space:nowrap;
  background: linear-gradient(135deg,#667eea 0%,#764ba2 100%);
  box-shadow: 0 2px 8px rgba(102,126,234,.4);
  transition:all .18s; flex-shrink:0;
}
.quota-badge-new:hover { transform:translateY(-1px); box-shadow:0 4px 14px rgba(102,126,234,.5); }
.qb-label { padding:0 8px 0 12px; font-size:11px; color:rgba(255,255,255,.8); }
.qb-num   { padding:0 8px; font-size:13px; font-weight:700; color:#fff; }
.qb-cta   { background:rgba(255,255,255,.22); padding:0 10px; height:30px; display:flex; align-items:center; font-size:11px; font-weight:600; color:#fff; border-left:1px solid rgba(255,255,255,.2); }

/* 邀请横幅 */
.invite-banner {
  border-radius:14px;
  background: linear-gradient(135deg, #6B46C1 0%, #B8368C 50%, #F25F4C 100%);
  padding:16px 20px;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:16px;
  flex-wrap:wrap;
}
.invite-banner-left  { flex:1; min-width:180px; }
.invite-title  { font-size:15px; font-weight:700; color:#fff; margin-bottom:4px; }
.invite-desc   { font-size:12px; color:rgba(255,255,255,.75); }
.invite-count-badge { display:inline-flex; align-items:center; gap:4px; margin-top:8px; background:rgba(255,255,255,.2); border-radius:20px; padding:3px 10px; font-size:11px; color:#fff; }
.invite-banner-right { text-align:center; }
.invite-code-label  { font-size:11px; color:rgba(255,255,255,.7); margin-bottom:6px; }
.invite-code-row    { display:flex; align-items:center; gap:8px; }
.invite-code-text   { font-size:20px; font-weight:800; letter-spacing:4px; color:#fff; font-family:monospace; background:rgba(255,255,255,.15); padding:6px 14px; border-radius:8px; }
.invite-copy-btn {
  height:34px; padding:0 14px; border-radius:8px;
  background:rgba(255,255,255,.25); border:1px solid rgba(255,255,255,.4);
  color:#fff; font-size:12px; font-weight:600; cursor:pointer;
  transition:all .15s; white-space:nowrap;
}
.invite-copy-btn:hover  { background:rgba(255,255,255,.4); }
.invite-copy-btn.copied { background:rgba(0,180,42,.7); border-color:transparent; }

.logout-btn {
  width:32px; height:32px; border-radius:8px; background:transparent; border:none;
  cursor:pointer; display:flex; align-items:center; justify-content:center;
  color:#86909C; transition:all .15s; flex-shrink:0;
}
.logout-btn:hover { background:#FFF0EE; color:#F53F3F; }

.menu-btn {
  width:32px; height:32px; border-radius:8px; background:transparent; border:none;
  cursor:pointer; display:flex; align-items:center; justify-content:center;
  color:#4E5969; transition:all .15s;
}
.menu-btn:hover { background:#F2F3F5; }

.mobile-menu-item {
  display:flex; align-items:center; gap:8px; padding:10px 14px;
  border-radius:10px; background:#F7F8FA; border:1px solid #F0F1F3;
  cursor:pointer; font-size:14px; color:#1D2129;
  transition:all .15s;
}
.mobile-menu-item:hover { background:#EEF3FF; border-color:#C2D4FF; }
.mobile-menu-item:active { transform:scale(.97); }

/* 汉堡菜单动画 */
.menu-drop-enter-active,.menu-drop-leave-active { transition:all .2s ease; }
.menu-drop-enter-from,.menu-drop-leave-to { opacity:0; transform:translateY(-8px); }
</style>
