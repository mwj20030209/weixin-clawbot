<script setup lang="ts">
import { ref, reactive, watch, computed } from 'vue'
import { Brain, Trash2, Save, RefreshCw, ChevronLeft } from 'lucide-vue-next'
import { apiUrl } from '../lib/api'

type UserSession = { bot_id: string; user_id: string; last_seen: string }
type Memory      = { id: number; content: string; created_at: string }
type BaseRole    = { bot_id: string; user_id: string; base_prompt: string; last_update: string | null }

const props = defineProps<{ open: boolean; token: string }>()
const emit  = defineEmits<{ (e: 'update:open', v: boolean): void }>()

const users      = ref<UserSession[]>([])
const memories   = ref<Memory[]>([])
const baseRole   = ref<BaseRole | null>(null)
const loading    = ref(false)
const savingRole = ref(false)
const deletingId = ref<number | null>(null)
const editPrompt = ref('')
const errMsg     = ref('')
const saveOk     = ref(false)
const mobileView = ref<'list' | 'detail'>('list')

const selectedBot    = ref('')
const selectedUserId = ref('')

// Bot 去重列表
const botIds = computed(() => [...new Set(users.value.map(u => u.bot_id))])
// 根据选中 Bot 过滤用户
const filteredUsers = computed(() =>
  selectedBot.value
    ? users.value.filter(u => u.bot_id === selectedBot.value)
    : users.value
)

function authHeaders() {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${props.token}` }
}

async function loadUsers() {
  loading.value = true
  try {
    const data = await fetch(apiUrl('/api/memory-users'), { headers: authHeaders() }).then(r => r.json())
    users.value = Array.isArray(data) ? data : []
    if (users.value.length && !selectedBot.value) selectedBot.value = users.value[0].bot_id
  } finally { loading.value = false }
}

async function selectUser(u: UserSession) {
  selectedUserId.value = u.user_id
  selectedBot.value    = u.bot_id
  mobileView.value     = 'detail'
  errMsg.value = ''; saveOk.value = false
  await loadDetail()
}

async function loadDetail() {
  if (!selectedBot.value || !selectedUserId.value) return
  loading.value = true
  try {
    const [mems, role] = await Promise.all([
      fetch(apiUrl(`/api/memory/${selectedBot.value}/${selectedUserId.value}`), { headers: authHeaders() }).then(r => r.json()),
      fetch(apiUrl(`/api/base-role/${selectedBot.value}/${selectedUserId.value}`), { headers: authHeaders() }).then(r => r.json()),
    ])
    memories.value  = Array.isArray(mems) ? mems : []
    baseRole.value  = role
    editPrompt.value = role?.base_prompt ?? ''
  } finally { loading.value = false }
}

async function delMemory(id: number) {
  if (!confirm('确认删除该条记忆？')) return
  deletingId.value = id
  try {
    await fetch(apiUrl(`/api/memory/${id}`), { method: 'DELETE', headers: authHeaders() })
    memories.value = memories.value.filter(m => m.id !== id)
  } finally { deletingId.value = null }
}

async function saveRole() {
  if (!selectedBot.value || !selectedUserId.value) return
  savingRole.value = true; errMsg.value = ''; saveOk.value = false
  try {
    const res = await fetch(apiUrl(`/api/base-role/${selectedBot.value}/${selectedUserId.value}`), {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ base_prompt: editPrompt.value }),
    })
    const data = await res.json()
    if (!res.ok) { errMsg.value = data.error ?? '保存失败'; return }
    saveOk.value = true
    setTimeout(() => { saveOk.value = false }, 2500)
  } finally { savingRole.value = false }
}

function formatTime(ts: string) {
  return ts ? new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''
}

watch(() => props.open, v => {
  if (v) {
    loadUsers()
    mobileView.value = 'list'
    selectedUserId.value = ''
    memories.value = []; baseRole.value = null; editPrompt.value = ''
  }
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
        :style="{ width:'100%', maxWidth:'900px', borderLeft:'1px solid #F2F3F5' }">

        <!-- Header -->
        <div class="px-4 sm:px-6 py-4 border-b border-[#F2F3F5] flex items-center justify-between gap-2">
          <button v-if="mobileView === 'detail'" class="sm:hidden back-btn" @click="mobileView = 'list'">
            <ChevronLeft :size="18" />
          </button>
          <div class="flex-1 flex items-center gap-2 min-w-0">
            <Brain :size="18" style="color:#7B61FF;flex-shrink:0" />
            <div>
              <h2 class="text-[16px]" style="color:#1D2129">记忆管理</h2>
              <p class="text-[12px] text-[#86909C] mt-0.5 hidden sm:block">查看 / 编辑每位用户的长期记忆与专属成长人设</p>
            </div>
          </div>
          <button class="close-btn" @click="emit('update:open', false)">✕</button>
        </div>

        <!-- Body -->
        <div class="flex flex-1 overflow-hidden flex-col sm:flex-row">

          <!-- 左侧用户列表 -->
          <div :class="['sm:flex flex-col w-full sm:w-[240px] sm:shrink-0 sm:border-r border-[#F2F3F5] bg-[#FAFBFC]',
                        mobileView === 'detail' ? 'hidden sm:flex' : 'flex']">
            <!-- Bot 筛选 -->
            <div class="p-3 border-b border-[#F2F3F5] space-y-2">
              <select v-model="selectedBot" class="form-input text-[13px] py-1.5">
                <option value="">全部 Bot</option>
                <option v-for="b in botIds" :key="b" :value="b">{{ b.slice(0, 20) }}</option>
              </select>
            </div>
            <div class="flex-1 overflow-auto py-1">
              <div v-if="loading && users.length === 0" class="text-[12px] text-[#86909C] text-center py-8">加载中...</div>
              <div v-else-if="filteredUsers.length === 0" class="text-[12px] text-[#86909C] text-center py-8 px-3 leading-relaxed">
                暂无活跃用户记录<br/>有用户和 Bot 聊天后才会出现
              </div>
              <button v-for="u in filteredUsers" :key="u.bot_id + u.user_id"
                class="user-item" :class="{ active: u.user_id === selectedUserId && u.bot_id === selectedBot }"
                @click="selectUser(u)">
                <div class="text-[13px] truncate" style="color:#1D2129">{{ u.user_id.slice(0, 18) }}</div>
                <div class="text-[11px] text-[#86909C] mt-0.5 truncate">{{ u.bot_id.slice(0, 16) }} · {{ formatTime(u.last_seen) }}</div>
              </button>
            </div>
            <div class="p-3 border-t border-[#F2F3F5]">
              <button class="refresh-btn w-full" :disabled="loading" @click="loadUsers">
                <RefreshCw :size="13" :class="{ 'animate-spin': loading }" />
                刷新列表
              </button>
            </div>
          </div>

          <!-- 右侧详情 -->
          <div :class="['flex-1 flex flex-col overflow-hidden',
                        mobileView === 'list' ? 'hidden sm:flex' : 'flex']">

            <!-- 空状态 -->
            <div v-if="!selectedUserId" class="flex-1 flex items-center justify-center">
              <div class="text-center text-[#86909C]">
                <div class="text-5xl mb-3 opacity-20">🧠</div>
                <div class="text-[14px]">从左侧选择一个用户，查看 TA 的记忆</div>
              </div>
            </div>

            <div v-else class="flex-1 overflow-auto px-5 py-4 space-y-5">

              <!-- 专属成长人设 -->
              <div class="rounded-[10px] border border-[#D5E0FF]" style="background:#F5F7FF;">
                <div class="px-4 py-3 flex items-center justify-between border-b border-[#D5E0FF]">
                  <div>
                    <span class="text-[13px] font-semibold" style="color:#4080FF">专属成长人设</span>
                    <span v-if="baseRole?.last_update" class="ml-2 text-[11px] text-[#86909C]">最后更新：{{ baseRole.last_update }}</span>
                  </div>
                  <button class="btn btn-save" :disabled="savingRole" @click="saveRole">
                    <Save :size="13" />
                    {{ savingRole ? '保存中...' : '保存' }}
                  </button>
                </div>
                <div class="p-4">
                  <textarea v-model="editPrompt" class="form-input"
                    style="min-height:140px;resize:vertical;line-height:1.7;font-size:13px;"
                    placeholder="此处会自动记录 AI 每周提炼的人格特征，也可手动补充或修改..." />
                  <div v-if="errMsg" class="mt-2 text-[12px] text-red-500">{{ errMsg }}</div>
                  <div v-if="saveOk"  class="mt-2 text-[12px] text-green-600">✓ 已保存</div>
                  <div class="mt-2 text-[11px] text-[#86909C]">
                    此内容每次聊天都会注入 AI System Prompt 末尾（第一段），AI 会"记住"这些特征。
                  </div>
                </div>
              </div>

              <!-- 长期记忆列表 -->
              <div>
                <div class="flex items-center justify-between mb-2">
                  <span class="text-[13px] font-semibold" style="color:#1D2129">
                    长期记忆
                    <span class="ml-1 text-[11px] text-[#86909C] font-normal">共 {{ memories.length }} 条</span>
                  </span>
                  <button class="refresh-btn" :disabled="loading" @click="loadDetail">
                    <RefreshCw :size="12" :class="{ 'animate-spin': loading }" />
                    刷新
                  </button>
                </div>
                <div v-if="memories.length === 0" class="text-[13px] text-[#86909C] text-center py-8 rounded-[8px] border border-dashed border-[#E5E6EB]">
                  暂无长期记忆，聊天后 AI 会自动提取并存储
                </div>
                <div v-else class="space-y-2">
                  <div v-for="m in memories" :key="m.id"
                    class="flex items-start gap-2 p-3 rounded-[8px] border border-[#F2F3F5] bg-white hover:bg-[#FAFBFC] transition-colors">
                    <div class="flex-1 min-w-0">
                      <div class="text-[13px] leading-relaxed" style="color:#1D2129">{{ m.content }}</div>
                      <div class="text-[11px] text-[#C9CDD4] mt-1">{{ formatTime(m.created_at) }}</div>
                    </div>
                    <button class="del-btn flex-shrink-0"
                      :disabled="deletingId === m.id"
                      @click="delMemory(m.id)">
                      <Trash2 :size="13" />
                    </button>
                  </div>
                </div>
              </div>

              <!-- 说明区 -->
              <div class="rounded-[8px] p-3 text-[11px] text-[#86909C] space-y-1 leading-relaxed" style="background:#F7F8FA;border:1px solid #E5E6EB;">
                <div>🤖 <strong>长期记忆</strong>：每次 AI 回复后自动提取生日、爱好、作息、昵称、纪念日等写入此表</div>
                <div>🔍 每次聊天按关键词匹配最相关 5 条注入 Prompt 第二段</div>
                <div>🌱 <strong>专属人设</strong>：每周一凌晨 3 点，AI 提炼本周口头禅和小习惯追加至人设，日积月累越来越贴合</div>
              </div>
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
.back-btn  { width:32px;height:32px;border-radius:8px;background:transparent;border:none;cursor:pointer;color:#4E5969;display:flex;align-items:center;justify-content:center;transition:all .15s;flex-shrink:0; }
.back-btn:hover { background:#F2F3F5; }

.user-item { width:100%;display:block;padding:10px 12px;text-align:left;background:transparent;border:none;cursor:pointer;border-bottom:1px solid #F7F8FA;transition:background .15s; }
.user-item:hover { background:rgba(255,255,255,.6); }
.user-item.active { background:#fff;box-shadow:inset 3px 0 0 #7B61FF; }

.form-input { width:100%;padding:10px 12px;background:#fff;color:#1D2129;border:1px solid #E5E6EB;border-radius:8px;font-size:14px;outline:none;font-family:inherit;transition:border-color .15s,box-shadow .15s; }
.form-input:focus { border-color:#4080FF;box-shadow:0 0 0 3px rgba(64,128,255,.15); }

.btn { height:32px;padding:0 12px;border-radius:7px;font-size:12px;cursor:pointer;border:none;display:inline-flex;align-items:center;justify-content:center;gap:5px;transition:all .15s; }
.btn:disabled { opacity:.6;cursor:not-allowed; }
.btn-save { background:#4080FF;color:#fff; }
.btn-save:hover:not(:disabled) { background:#2D6FED; }

.del-btn { width:28px;height:28px;border-radius:7px;background:transparent;border:none;cursor:pointer;color:#86909C;display:flex;align-items:center;justify-content:center;transition:all .15s; }
.del-btn:hover:not(:disabled) { background:rgba(245,63,63,.08);color:#F53F3F; }
.del-btn:disabled { opacity:.4;cursor:not-allowed; }

.refresh-btn { height:30px;padding:0 10px;border-radius:7px;background:transparent;border:1px solid #E5E6EB;color:#4E5969;font-size:12px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:5px;transition:all .15s; }
.refresh-btn:hover:not(:disabled) { background:#F2F3F5; }
.refresh-btn:disabled { opacity:.5;cursor:not-allowed; }

.drawer-mask-enter-active,.drawer-mask-leave-active { transition:opacity .25s ease; }
.drawer-mask-enter-from,.drawer-mask-leave-to { opacity:0; }
.drawer-enter-active,.drawer-leave-active { transition:transform .3s cubic-bezier(.16,1,.3,1); }
.drawer-enter-from,.drawer-leave-to { transform:translateX(100%); }
</style>
