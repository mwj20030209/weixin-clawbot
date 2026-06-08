<script setup lang="ts">
import { ref, reactive, watch, onMounted } from 'vue'
import { Plus, Save, Trash2, ShieldCheck, User, Eye, EyeOff, ChevronLeft, Plus as PlusIcon, Minus } from 'lucide-vue-next'
import { apiUrl } from '../lib/api'

type UserRow = { id: number; username: string; password_plain: string; role: 'admin' | 'user'; quota: number; invite_code: string; invite_count: number; created_at: string }

const props = defineProps<{ open: boolean; token: string }>()
const emit  = defineEmits<{ (e: 'update:open', v: boolean): void }>()

const users     = ref<UserRow[]>([])
const activeId  = ref<number | null>(null)
const isCreating = ref(false)
const loading   = ref(false)
const saving    = ref(false)
const deleting  = ref(false)
const errMsg    = ref('')
const showPwd   = ref(false)
const mobileView = ref<'list' | 'form'>('list')
const quotaInput = ref(0)
const quotaDelta = ref(100)
const adjustingQuota = ref(false)

const form = reactive({ username: '', password: '', role: 'user' as 'admin' | 'user' })

function authHeaders() {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${props.token}` }
}

async function loadUsers() {
  loading.value = true
  try {
    users.value = await fetch(apiUrl('/api/users'), { headers: authHeaders() }).then(r => r.json())
    if (users.value.length && !activeId.value && !isCreating.value) {
      selectUser(users.value[0])
    }
  } finally { loading.value = false }
}

function selectUser(u: UserRow) {
  activeId.value  = u.id
  isCreating.value = false
  mobileView.value = 'form'
  form.username = u.username
  form.password = u.password_plain ?? ''
  form.role     = u.role
  quotaInput.value = u.quota ?? 0
  showPwd.value = false
  errMsg.value  = ''
}

function newUser() {
  activeId.value   = null
  isCreating.value = true
  mobileView.value = 'form'
  form.username = ''
  form.password = ''
  form.role     = 'user'
  errMsg.value  = ''
}

async function adjustQuota(delta: number) {
  if (!activeId.value) return
  adjustingQuota.value = true
  try {
    const res  = await fetch(apiUrl(`/api/users/${activeId.value}/quota`), {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({ delta }),
    })
    const data = await res.json()
    if (!res.ok) { errMsg.value = data.error ?? '调整失败'; return }
    quotaInput.value = data.quota
    const u = users.value.find(x => x.id === activeId.value)
    if (u) u.quota = data.quota
  } finally { adjustingQuota.value = false }
}

async function save() {
  if (!form.username.trim())               { errMsg.value = '请输入账号'; return }
  if (isCreating.value && !form.password.trim()) { errMsg.value = '新建时必须设置密码'; return }

  saving.value = true; errMsg.value = ''
  try {
    const body: any = { username: form.username.trim(), role: form.role }
    if (form.password.trim()) body.password = form.password.trim()

    const url    = isCreating.value ? '/api/users' : `/api/users/${activeId.value}`
    const method = isCreating.value ? 'POST' : 'PUT'
    const res  = await fetch(apiUrl(url), { method, headers: authHeaders(), body: JSON.stringify(body) })
    const data = await res.json()
    if (!res.ok) { errMsg.value = data.error ?? '保存失败'; return }

    isCreating.value = false
    await loadUsers()
    const newId = data.id ?? activeId.value
    const found = users.value.find(u => u.id === newId)
    if (found) selectUser(found)
  } finally { saving.value = false }
}

async function del() {
  if (!activeId.value) return
  const u = users.value.find(x => x.id === activeId.value)
  if (!u) return
  if (!confirm(`确定要删除用户「${u.username}」吗？`)) return
  deleting.value = true
  try {
    const res  = await fetch(apiUrl(`/api/users/${activeId.value}`), { method: 'DELETE', headers: authHeaders() })
    const data = await res.json()
    if (!res.ok) { errMsg.value = data.error ?? '删除失败'; return }
    activeId.value = null
    await loadUsers()
    if (users.value.length) selectUser(users.value[0])
  } finally { deleting.value = false }
}

watch(() => props.open, v => {
  if (v) loadUsers()
  else mobileView.value = 'list'
})
onMounted(() => { if (props.open) loadUsers() })
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
        :style="{ width:'100%', maxWidth:'700px', borderLeft:'1px solid #F2F3F5' }">

        <!-- Header -->
        <div class="px-4 sm:px-6 py-4 sm:py-5 border-b border-[#F2F3F5] flex items-center justify-between gap-2">
          <button v-if="mobileView === 'form'" class="sm:hidden back-btn" @click="mobileView = 'list'">
            <ChevronLeft :size="18" />
          </button>
          <div class="flex-1 min-w-0">
            <h2 class="text-[16px]" style="color:#1D2129">用户管理</h2>
            <p class="text-[12px] text-[#86909C] mt-0.5 hidden sm:block">管理系统账号，分配管理员/普通用户角色</p>
          </div>
          <button class="close-btn" @click="emit('update:open', false)">✕</button>
        </div>

        <div class="flex flex-1 overflow-hidden flex-col sm:flex-row">
          <!-- 左侧列表 -->
          <div :class="['sm:flex flex-col w-full sm:w-[220px] sm:shrink-0 sm:border-r border-[#F2F3F5] bg-[#FAFBFC]',
                        mobileView === 'form' ? 'hidden sm:flex' : 'flex']">
            <div class="p-3 border-b border-[#F2F3F5]">
              <button class="new-btn w-full" @click="newUser">
                <Plus :size="14" /> 新建用户
              </button>
            </div>
            <div class="flex-1 overflow-auto py-1">
              <div v-if="loading" class="text-[12px] text-[#86909C] text-center py-8">加载中...</div>
              <div v-else-if="users.length === 0" class="text-[12px] text-[#86909C] text-center py-8">暂无用户</div>
              <button v-for="u in users" :key="u.id"
                class="user-item" :class="{ active: u.id === activeId }"
                @click="selectUser(u)">
                <div class="flex items-center gap-2 min-w-0">
                  <component :is="u.role === 'admin' ? ShieldCheck : User" :size="13"
                    :style="{ color: u.role === 'admin' ? '#4080FF' : '#86909C', flexShrink: 0 }" />
                  <span class="truncate text-[13px]" style="color:#1D2129">{{ u.username }}</span>
                </div>
                <div class="text-[11px] text-[#86909C] mt-0.5 text-left flex items-center gap-2">
                  <span>密码：{{ u.password_plain || '—' }}</span>
                  <span class="text-[#4080FF] font-medium">额度:{{ u.quota ?? 0 }}</span>
                </div>
                <span class="role-badge" :class="u.role">{{ u.role === 'admin' ? '管理员' : '普通用户' }}</span>
              </button>
            </div>
          </div>

          <!-- 右侧编辑 -->
          <div :class="['flex-1 flex flex-col overflow-hidden',
                        mobileView === 'list' ? 'hidden sm:flex' : 'flex']">
            <div v-if="activeId === null && !isCreating"
              class="flex-1 flex items-center justify-center">
              <div class="text-center text-[#86909C]">
                <div class="text-5xl mb-3 opacity-20">👥</div>
                <div class="text-[14px]">选择用户进行编辑，或点击「新建用户」</div>
              </div>
            </div>

            <div v-else class="flex-1 overflow-auto px-6 py-5 space-y-4">
              <div>
                <label class="block text-[12px] text-[#86909C] mb-1.5">账号</label>
                <input v-model="form.username" class="form-input" placeholder="登录账号" />
              </div>
              <div>
                <label class="block text-[12px] text-[#86909C] mb-1.5">密码</label>
                <div class="relative">
                  <input
                    v-model="form.password"
                    :type="showPwd ? 'text' : 'password'"
                    class="form-input pr-10"
                    :placeholder="isCreating ? '设置登录密码' : '修改密码'"
                  />
                  <button class="absolute right-3 top-1/2 -translate-y-1/2 text-[#86909C] hover:text-[#4080FF]"
                    style="background:none;border:none;cursor:pointer;padding:0"
                    @click="showPwd = !showPwd">
                    <Eye v-if="!showPwd" :size="16" />
                    <EyeOff v-else :size="16" />
                  </button>
                </div>
              </div>
              <div>
                <label class="block text-[12px] text-[#86909C] mb-1.5">角色</label>
                <div class="flex gap-3">
                  <label class="role-option" :class="{ selected: form.role === 'user' }">
                    <input type="radio" value="user" v-model="form.role" class="hidden" />
                    <User :size="15" />
                    <span>普通用户</span>
                    <span class="text-[11px] text-[#86909C] block mt-0.5">只能看自己的 Bot</span>
                  </label>
                  <label class="role-option" :class="{ selected: form.role === 'admin' }">
                    <input type="radio" value="admin" v-model="form.role" class="hidden" />
                    <ShieldCheck :size="15" />
                    <span>管理员</span>
                    <span class="text-[11px] text-[#86909C] block mt-0.5">可看全部 Bot & 用户</span>
                  </label>
                </div>
              </div>

              <!-- 额度管理 (only for existing users) -->
              <div v-if="activeId !== null && !isCreating">
                <label class="block text-[12px] text-[#86909C] mb-2">剩余额度：<span class="text-[#1D2129] font-semibold text-[14px]">{{ quotaInput }}</span> 条</label>
                <div class="flex items-center gap-2">
                  <input v-model.number="quotaDelta" type="number" min="1" class="form-input" style="width:90px" placeholder="条数" />
                  <button class="btn btn-primary" :disabled="adjustingQuota" @click="adjustQuota(quotaDelta)">
                    <PlusIcon :size="13" /> 增加
                  </button>
                  <button class="btn btn-danger" style="padding:0 12px" :disabled="adjustingQuota" @click="adjustQuota(-quotaDelta)">
                    <Minus :size="13" /> 扣减
                  </button>
                </div>
              </div>

              <div v-if="errMsg" class="err-box">{{ errMsg }}</div>
            </div>

            <div v-if="activeId !== null || isCreating"
              class="px-6 py-4 border-t border-[#F2F3F5] bg-[#FAFBFC] flex items-center gap-2">
              <button class="btn btn-primary flex-1" :disabled="saving" @click="save">
                <Save :size="14" />
                {{ saving ? '保存中...' : (isCreating ? '创建用户' : '保存修改') }}
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
.close-btn {
  width:32px;height:32px;border-radius:8px;background:transparent;border:none;cursor:pointer;
  color:#86909C;font-size:16px;transition:all .15s;
}
.close-btn:hover { background:#F2F3F5;color:#1D2129; }

.back-btn {
  width:32px;height:32px;border-radius:8px;background:transparent;border:none;cursor:pointer;
  color:#4E5969;display:flex;align-items:center;justify-content:center;transition:all .15s;flex-shrink:0;
}
.back-btn:hover { background:#F2F3F5; }

.new-btn {
  height:36px;padding:0 12px;border-radius:8px;background:#4080FF;color:#fff;border:none;cursor:pointer;
  display:inline-flex;align-items:center;justify-content:center;gap:6px;font-size:13px;transition:background .15s;
}
.new-btn:hover { background:#2D6FED; }

.user-item {
  width:100%;display:flex;flex-direction:column;padding:10px 12px;text-align:left;
  background:transparent;border:none;cursor:pointer;transition:background .15s;gap:4px;
}
.user-item:hover { background:rgba(255,255,255,.6); }
.user-item.active { background:#fff;box-shadow:inset 3px 0 0 #4080FF; }

.role-badge {
  font-size:10px;font-weight:500;padding:1px 6px;border-radius:20px;align-self:flex-start;
}
.role-badge.admin { background:rgba(64,128,255,.12);color:#4080FF; }
.role-badge.user  { background:rgba(134,144,156,.12);color:#86909C; }

.form-input {
  width:100%;padding:10px 12px;background:#fff;color:#1D2129;
  border:1px solid #E5E6EB;border-radius:8px;font-size:14px;outline:none;font-family:inherit;
  transition:border-color .15s,box-shadow .15s;
}
.form-input:focus { border-color:#4080FF;box-shadow:0 0 0 3px rgba(64,128,255,.15); }

.role-option {
  flex:1;padding:12px;border:1.5px solid #E5E6EB;border-radius:10px;cursor:pointer;
  display:flex;flex-direction:column;align-items:center;gap:4px;text-align:center;
  font-size:13px;color:#4E5969;transition:all .15s;
}
.role-option.selected { border-color:#4080FF;background:rgba(64,128,255,.06);color:#4080FF; }
.role-option:hover:not(.selected) { border-color:#C2D4FF;background:#F7F9FF; }

.err-box {
  padding:10px 12px;background:rgba(245,63,63,.08);border:1px solid rgba(245,63,63,.25);
  border-radius:8px;color:#F53F3F;font-size:13px;
}

.btn {
  height:36px;padding:0 16px;border-radius:8px;font-size:13px;cursor:pointer;border:none;
  display:inline-flex;align-items:center;justify-content:center;gap:6px;transition:all .15s;
}
.btn:disabled { opacity:.6;cursor:not-allowed; }
.btn-primary { background:#4080FF;color:#fff; }
.btn-primary:hover:not(:disabled) { background:#2D6FED; }
.btn-danger  { background:transparent;color:#F53F3F;border:1px solid rgba(245,63,63,.4); }
.btn-danger:hover:not(:disabled) { background:rgba(245,63,63,.08); }

.drawer-mask-enter-active,.drawer-mask-leave-active { transition:opacity .25s ease; }
.drawer-mask-enter-from,.drawer-mask-leave-to { opacity:0; }
.drawer-enter-active,.drawer-leave-active { transition:transform .3s cubic-bezier(.16,1,.3,1); }
.drawer-enter-from,.drawer-leave-to { transform:translateX(100%); }
</style>
