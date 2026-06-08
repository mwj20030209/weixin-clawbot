<script setup lang="ts">
import { ref, reactive, watch } from 'vue'
import { Plus, Save, Trash2, Play, Clock, ChevronLeft } from 'lucide-vue-next'
import { apiUrl } from '../lib/api'

type ScheduledMsg = {
  id: number; name: string; send_time: string; time_window: number
  message: string; target_bot: string | null; is_active: number
  use_ai: number; ai_prompt: string | null; created_at: string
}

const props = defineProps<{ open: boolean; token: string }>()
const emit  = defineEmits<{ (e: 'update:open', v: boolean): void }>()

const msgs       = ref<ScheduledMsg[]>([])
const activeId   = ref<number | null>(null)
const isCreating = ref(false)
const loading    = ref(false)
const saving     = ref(false)
const deleting   = ref(false)
const testing    = ref(false)
const testResult = ref('')
const errMsg     = ref('')
const mobileView = ref<'list' | 'form'>('list')

const form = reactive({
  name: '', sendTime: '08:00', timeWindow: 0, message: '', targetBot: '', isActive: true,
  useAi: false, aiPrompt: '',
})

function authHeaders() {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${props.token}` }
}

async function load() {
  loading.value = true
  try {
    const data = await fetch(apiUrl('/api/scheduled-messages'), { headers: authHeaders() }).then(r => r.json())
    msgs.value = Array.isArray(data) ? data : []
    if (msgs.value.length && activeId.value === null && !isCreating.value) select(msgs.value[0])
  } finally { loading.value = false }
}

function select(m: ScheduledMsg) {
  activeId.value   = m.id
  isCreating.value = false
  mobileView.value = 'form'
  form.name       = m.name
  form.sendTime   = m.send_time
  form.timeWindow = m.time_window ?? 0
  form.message    = m.message
  form.targetBot  = m.target_bot ?? ''
  form.isActive   = !!m.is_active
  form.useAi      = !!m.use_ai
  form.aiPrompt   = m.ai_prompt ?? ''
  testResult.value = ''
  errMsg.value   = ''
}

function newMsg() {
  activeId.value   = null
  isCreating.value = true
  mobileView.value = 'form'
  form.name = ''; form.sendTime = '08:00'; form.timeWindow = 0; form.message = ''
  form.targetBot = ''; form.isActive = true; form.useAi = false; form.aiPrompt = ''
  testResult.value = ''; errMsg.value = ''
}

async function save() {
  if (!form.name.trim())             { errMsg.value = '请输入消息名称'; return }
  if (!form.sendTime)                { errMsg.value = '请输入发送时间'; return }
  if (!form.useAi && !form.message.trim()) { errMsg.value = '未启用AI时备用文案不能为空'; return }
  saving.value = true; errMsg.value = ''
  try {
    const body = {
      name: form.name.trim(), sendTime: form.sendTime, timeWindow: form.timeWindow,
      message: form.message.trim(), targetBot: form.targetBot || null,
      isActive: form.isActive, useAi: form.useAi,
      aiPrompt: form.useAi ? form.aiPrompt.trim() || null : null,
    }
    const url    = isCreating.value ? '/api/scheduled-messages' : `/api/scheduled-messages/${activeId.value}`
    const method = isCreating.value ? 'POST' : 'PUT'
    const res  = await fetch(apiUrl(url), { method, headers: authHeaders(), body: JSON.stringify(body) })
    const data = await res.json()
    if (!res.ok) { errMsg.value = data.error ?? '保存失败'; return }
    isCreating.value = false
    await load()
    const newId = data.id ?? activeId.value
    const found = msgs.value.find(m => m.id === newId)
    if (found) select(found)
  } finally { saving.value = false }
}

async function del() {
  if (!activeId.value) return
  const m = msgs.value.find(x => x.id === activeId.value)
  if (!m || !confirm(`确定删除「${m.name}」？`)) return
  deleting.value = true
  try {
    const res  = await fetch(apiUrl(`/api/scheduled-messages/${activeId.value}`), { method: 'DELETE', headers: authHeaders() })
    const data = await res.json()
    if (!res.ok) { errMsg.value = data.error ?? '删除失败'; return }
    activeId.value = null; isCreating.value = false
    await load()
    if (msgs.value.length) select(msgs.value[0])
    else mobileView.value = 'list'
  } finally { deleting.value = false }
}

async function testSend() {
  if (!activeId.value) return
  testing.value = true; testResult.value = ''
  try {
    const res  = await fetch(apiUrl(`/api/scheduled-messages/${activeId.value}/send-now`), { method: 'POST', headers: authHeaders() })
    const data = await res.json()
    if (!res.ok) { testResult.value = `❌ 失败：${data.error}`; return }
    testResult.value = `✅ 已发送给 ${data.sent} 个用户`
  } finally { testing.value = false }
}

watch(() => props.open, v => {
  if (v) { activeId.value = null; load() }
  else   mobileView.value = 'list'
})
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer-mask">
      <div v-if="open" class="fixed inset-0 z-[180]"
        style="background:rgba(29,33,41,.35);backdrop-filter:blur(2px);"
        @click="emit('update:open', false)" />
    </Transition>

    <Transition name="drawer">
      <aside v-if="open" class="fixed top-0 right-0 bottom-0 z-[181] bg-white flex flex-col"
        :style="{ width:'100%', maxWidth:'820px', borderLeft:'1px solid #F2F3F5' }">

        <!-- Header -->
        <div class="px-4 sm:px-6 py-4 sm:py-5 border-b border-[#F2F3F5] flex items-center justify-between gap-2">
          <button v-if="mobileView === 'form'" class="sm:hidden back-btn" @click="mobileView = 'list'">
            <ChevronLeft :size="18" />
          </button>
          <div class="flex-1 min-w-0 flex items-center gap-2">
            <Clock :size="18" style="color:#4080FF;flex-shrink:0" />
            <div>
              <h2 class="text-[16px]" style="color:#1D2129">定时消息</h2>
              <p class="text-[12px] text-[#86909C] mt-0.5 hidden sm:block">设置定时推送，自动给所有聊过天的用户发消息</p>
            </div>
          </div>
          <button class="close-btn" @click="emit('update:open', false)">✕</button>
        </div>

        <!-- Body -->
        <div class="flex flex-1 overflow-hidden flex-col sm:flex-row">

          <!-- 左侧列表 -->
          <div :class="['sm:flex flex-col w-full sm:w-[220px] sm:shrink-0 sm:border-r border-[#F2F3F5] bg-[#FAFBFC]',
                        mobileView === 'form' ? 'hidden sm:flex' : 'flex']">
            <div class="p-3 border-b border-[#F2F3F5]">
              <button class="new-btn w-full" @click="newMsg">
                <Plus :size="14" /> 新建消息
              </button>
            </div>
            <div class="flex-1 overflow-auto py-1">
              <div v-if="loading" class="text-[12px] text-[#86909C] text-center py-8">加载中...</div>
              <div v-else-if="msgs.length === 0" class="text-[12px] text-[#86909C] text-center py-8 px-3 leading-relaxed">
                暂无定时消息<br/>点击「新建消息」添加
              </div>
              <button v-for="m in msgs" :key="m.id"
                class="msg-item" :class="{ active: m.id === activeId }"
                @click="select(m)">
                <div class="flex items-center gap-1.5 min-w-0">
                  <span class="truncate text-[13px]" style="color:#1D2129">{{ m.name }}</span>
                  <span v-if="m.use_ai" class="badge-ai">AI</span>
                  <span v-if="!m.is_active" class="badge-off">已暂停</span>
                </div>
                <div class="text-[11px] text-[#86909C] mt-0.5 text-left flex items-center gap-1">
                  <Clock :size="10" /> {{ m.send_time }}
                  <span v-if="m.time_window > 0">±{{ m.time_window }}分</span>
                  每天发送
                </div>
              </button>
            </div>
          </div>

          <!-- 右侧编辑区 -->
          <div :class="['flex-1 flex flex-col overflow-hidden',
                        mobileView === 'list' ? 'hidden sm:flex' : 'flex']">

            <!-- 空状态 -->
            <div v-if="activeId === null && !isCreating"
              class="flex-1 flex items-center justify-center">
              <div class="text-center text-[#86909C]">
                <div class="text-5xl mb-3 opacity-20">⏰</div>
                <div class="text-[14px]">选择左侧消息进行编辑，或点击「新建消息」</div>
              </div>
            </div>

            <!-- 编辑表单 -->
            <div v-else class="flex-1 overflow-auto px-6 py-5 space-y-4">

              <!-- 名称 + 时间 + 窗口 -->
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label class="block text-[12px] text-[#86909C] mb-1.5">消息名称 <span class="text-red-400">*</span></label>
                  <input v-model="form.name" class="form-input" placeholder="例如：早安问候、晚安祝福" />
                </div>
                <div>
                  <label class="block text-[12px] text-[#86909C] mb-1.5">窗口开始时间 <span class="text-red-400">*</span></label>
                  <input v-model="form.sendTime" type="time" class="form-input" />
                </div>
                <div>
                  <label class="block text-[12px] text-[#86909C] mb-1.5">随机窗口（分钟）</label>
                  <input v-model.number="form.timeWindow" type="number" min="0" max="120" class="form-input" placeholder="0 = 精确时间" />
                </div>
              </div>

              <!-- AI 开关 -->
              <div class="rounded-[8px] p-4" style="background:#F5F7FF;border:1px solid #D5E0FF;">
                <div class="flex items-center justify-between">
                  <div>
                    <div class="text-[13px] font-medium" style="color:#1D2129">使用 AI 自动生成内容</div>
                    <div class="text-[11px] mt-0.5" style="color:#86909C">根据提示词动态生成，每次发送都不一样</div>
                  </div>
                  <div class="toggle-wrap" @click="form.useAi = !form.useAi">
                    <div class="toggle" :class="{ on: form.useAi }">
                      <div class="toggle-dot"></div>
                    </div>
                  </div>
                </div>
                <div v-if="form.useAi" class="mt-3">
                  <label class="block text-[12px] text-[#86909C] mb-1.5">AI 提示词</label>
                  <textarea v-model="form.aiPrompt" class="form-input" style="min-height:90px;resize:none;line-height:1.7;"
                    placeholder="描述这条消息的风格和内容。例如：&#10;【早安问候】简短温柔的早安问候，时间是早上 7-8 点，要活泼可爱，自然地引导用户回复" />
                </div>
              </div>

              <!-- 消息内容 / 备用文案 -->
              <div>
                <div class="flex items-center justify-between mb-1.5">
                  <label class="text-[12px] text-[#86909C]">
                    {{ form.useAi ? '备用文案（AI失败时使用）' : '消息内容' }}
                    <span v-if="!form.useAi" class="text-red-400">*</span>
                  </label>
                  <span class="text-[11px] text-[#C9CDD4]">{{ form.message.length }} 字</span>
                </div>
                <textarea v-model="form.message" class="form-input"
                  style="min-height:120px;resize:none;line-height:1.7;"
                  :placeholder="form.useAi ? '可不填，AI失败时的备用文案...' : '早上好！今天也是充满活力的一天...'" />
              </div>

              <!-- 启用状态 -->
              <div class="flex items-center gap-3">
                <label class="flex items-center gap-2 cursor-pointer">
                  <div class="toggle-wrap" @click="form.isActive = !form.isActive">
                    <div class="toggle" :class="{ on: form.isActive }">
                      <div class="toggle-dot"></div>
                    </div>
                  </div>
                  <span class="text-[13px]" style="color:#1D2129">
                    {{ form.isActive ? '已启用（到时间自动发送）' : '已暂停' }}
                  </span>
                </label>
              </div>

              <!-- 说明 -->
              <div class="rounded-[8px] p-3" style="background:#F7F8FA;border:1px solid #E5E6EB;">
                <div class="text-[11px] text-[#86909C] leading-relaxed space-y-1">
                  <div>⏰ 每天在设定时间（带随机窗口）自动向过去 <strong>72小时</strong>内聊过天的用户发送</div>
                  <div>🎲 随机窗口：设定 30 则在开始时间后 0～30 分钟内随机触发，每天相同时刻发送</div>
                  <div>🤖 AI 模式：每次生成不同的文案，更自然不重复</div>
                  <div>🧪 可点击「立即测试」验证效果，不影响定时计划</div>
                </div>
              </div>

              <!-- 错误/测试结果 -->
              <div v-if="errMsg" class="err-box">{{ errMsg }}</div>
              <div v-if="testResult" class="test-result-box">{{ testResult }}</div>
            </div>

            <!-- 底部按钮 -->
            <div v-if="activeId !== null || isCreating"
              class="px-6 py-4 border-t border-[#F2F3F5] bg-[#FAFBFC] flex items-center gap-2">
              <button class="btn btn-primary flex-1" :disabled="saving" @click="save">
                <Save :size="14" />
                {{ saving ? '保存中...' : (isCreating ? '创建消息' : '保存修改') }}
              </button>
              <button v-if="activeId !== null"
                class="btn btn-test" :disabled="testing" @click="testSend">
                <Play :size="14" />
                {{ testing ? '发送中...' : '立即测试' }}
              </button>
              <button v-if="activeId !== null"
                class="btn btn-danger" :disabled="deleting" @click="del">
                <Trash2 :size="14" />
              </button>
            </div>
          </div>
        </div>
      </aside>
    </Transition>
  </Teleport>
</template>

<style scoped>
.close-btn { width:32px;height:32px;border-radius:8px;background:transparent;border:none;cursor:pointer;color:#86909C;font-size:16px;transition:all .15s; }
.close-btn:hover { background:#F2F3F5;color:#1D2129; }
.back-btn { width:32px;height:32px;border-radius:8px;background:transparent;border:none;cursor:pointer;color:#4E5969;display:flex;align-items:center;justify-content:center;transition:all .15s;flex-shrink:0; }
.back-btn:hover { background:#F2F3F5; }

.new-btn { height:36px;padding:0 12px;border-radius:8px;background:#4080FF;color:#fff;border:none;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;font-size:13px;transition:background .15s; }
.new-btn:hover { background:#2D6FED; }

.msg-item { width:100%;display:block;padding:10px 12px;text-align:left;background:transparent;border:none;cursor:pointer;transition:background .15s; }
.msg-item:hover { background:rgba(255,255,255,.6); }
.msg-item.active { background:#fff;box-shadow:inset 3px 0 0 #4080FF; }

.badge-off { padding:1px 5px;border-radius:20px;font-size:10px;font-weight:500;background:rgba(134,144,156,.12);color:#86909C;flex-shrink:0; }
.badge-ai  { padding:1px 5px;border-radius:20px;font-size:10px;font-weight:600;background:rgba(64,128,255,.12);color:#4080FF;flex-shrink:0; }

.form-input { width:100%;padding:10px 12px;background:#fff;color:#1D2129;border:1px solid #E5E6EB;border-radius:8px;font-size:14px;outline:none;font-family:inherit;transition:border-color .15s,box-shadow .15s; }
.form-input:focus { border-color:#4080FF;box-shadow:0 0 0 3px rgba(64,128,255,.15); }

/* Toggle */
.toggle-wrap { cursor:pointer; }
.toggle { width:40px;height:22px;border-radius:11px;background:#E5E6EB;position:relative;transition:background .2s; }
.toggle.on { background:#4080FF; }
.toggle-dot { width:18px;height:18px;border-radius:50%;background:#fff;position:absolute;top:2px;left:2px;transition:left .2s;box-shadow:0 1px 3px rgba(0,0,0,.2); }
.toggle.on .toggle-dot { left:20px; }

.err-box { padding:10px 12px;background:rgba(245,63,63,.08);border:1px solid rgba(245,63,63,.25);border-radius:8px;color:#F53F3F;font-size:13px; }
.test-result-box { padding:10px 12px;background:rgba(0,180,42,.06);border:1px solid rgba(0,180,42,.2);border-radius:8px;color:#00b42a;font-size:13px; }

.btn { height:36px;padding:0 16px;border-radius:8px;font-size:13px;cursor:pointer;border:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;transition:all .15s; }
.btn:disabled { opacity:.6;cursor:not-allowed; }
.btn-primary { background:#4080FF;color:#fff; }
.btn-primary:hover:not(:disabled) { background:#2D6FED; }
.btn-test { background:transparent;color:#7B61FF;border:1px solid rgba(123,97,255,.4); }
.btn-test:hover:not(:disabled) { background:rgba(123,97,255,.08); }
.btn-danger { background:transparent;color:#F53F3F;border:1px solid rgba(245,63,63,.4); }
.btn-danger:hover:not(:disabled) { background:rgba(245,63,63,.08); }

.drawer-mask-enter-active,.drawer-mask-leave-active { transition:opacity .25s ease; }
.drawer-mask-enter-from,.drawer-mask-leave-to { opacity:0; }
.drawer-enter-active,.drawer-leave-active { transition:transform .3s cubic-bezier(.16,1,.3,1); }
.drawer-enter-from,.drawer-leave-to { transform:translateX(100%); }
</style>
