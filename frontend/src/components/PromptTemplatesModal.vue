<script setup lang="ts">
import { ref, reactive, watch, onMounted } from 'vue'
import { Plus, Save, Trash2, ChevronLeft } from 'lucide-vue-next'
import { apiUrl } from '../lib/api'

type Tpl = { id: number; name: string; content: string }

const props = defineProps<{ open: boolean; token: string }>()
const emit  = defineEmits<{ (e: 'update:open', v: boolean): void }>()

const templates  = ref<Tpl[]>([])
const activeId   = ref<number | null>(null)
const isCreating = ref(false)
const loading    = ref(false)
const saving     = ref(false)
const deleting   = ref(false)
const errMsg     = ref('')

const form = reactive({ name: '', content: '' })

function authHeaders() {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${props.token}` }
}

async function load() {
  loading.value = true
  try {
    templates.value = await fetch(apiUrl('/api/prompt-templates'), { headers: authHeaders() }).then(r => r.json())
    if (templates.value.length && !activeId.value && !isCreating.value) select(templates.value[0])
  } finally { loading.value = false }
}

function select(t: Tpl) {
  activeId.value   = t.id
  isCreating.value = false
  mobileView.value = 'form'
  form.name        = t.name
  form.content     = t.content
  errMsg.value     = ''
}

function newTpl() {
  activeId.value   = null
  isCreating.value = true
  mobileView.value = 'form'
  form.name        = ''
  form.content     = ''
  errMsg.value     = ''
}

async function save() {
  if (!form.name.trim())    { errMsg.value = '请输入名称'; return }
  if (!form.content.trim()) { errMsg.value = '请输入提示词内容'; return }
  saving.value = true; errMsg.value = ''
  try {
    const url    = isCreating.value ? '/api/prompt-templates' : `/api/prompt-templates/${activeId.value}`
    const method = isCreating.value ? 'POST' : 'PUT'
    const res  = await fetch(apiUrl(url), { method, headers: authHeaders(), body: JSON.stringify({ name: form.name.trim(), content: form.content.trim() }) })
    const data = await res.json()
    if (!res.ok) { errMsg.value = data.error ?? '保存失败'; return }
    isCreating.value = false
    await load()
    const newId = data.id ?? activeId.value
    const found = templates.value.find(t => t.id === newId)
    if (found) select(found)
  } finally { saving.value = false }
}

async function del() {
  if (!activeId.value) return
  const t = templates.value.find(x => x.id === activeId.value)
  if (!t || !confirm(`确定删除「${t.name}」？`)) return
  deleting.value = true
  try {
    const res  = await fetch(apiUrl(`/api/prompt-templates/${activeId.value}`), { method: 'DELETE', headers: authHeaders() })
    const data = await res.json()
    if (!res.ok) { errMsg.value = data.error ?? '删除失败'; return }
    activeId.value = null
    await load()
    if (templates.value.length) select(templates.value[0])
  } finally { deleting.value = false }
}

const mobileView = ref<'list' | 'form'>('list')
watch(() => props.open, v => { if (v) load(); else mobileView.value = 'list' })
onMounted(() => { if (props.open) load() })
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
        :style="{ width:'100%', maxWidth:'720px', borderLeft:'1px solid #F2F3F5' }">

        <!-- Header -->
        <div class="px-4 sm:px-6 py-4 sm:py-5 border-b border-[#F2F3F5] flex items-center justify-between gap-2">
          <button v-if="mobileView === 'form'" class="sm:hidden back-btn" @click="mobileView = 'list'">
            <ChevronLeft :size="18" />
          </button>
          <div class="flex-1 min-w-0">
            <h2 class="text-[16px]" style="color:#1D2129">前置提示词库</h2>
            <p class="text-[12px] text-[#86909C] mt-0.5 hidden sm:block">管理生成人设时使用的前置提示词，可引导 AI 按特定风格生成</p>
          </div>
          <button class="close-btn" @click="emit('update:open', false)">✕</button>
        </div>

        <div class="flex flex-1 overflow-hidden flex-col sm:flex-row">
          <!-- 左侧列表 -->
          <div :class="['sm:flex flex-col w-full sm:w-[220px] sm:shrink-0 sm:border-r border-[#F2F3F5] bg-[#FAFBFC]',
                        mobileView === 'form' ? 'hidden sm:flex' : 'flex']">
            <div class="p-3 border-b border-[#F2F3F5]">
              <button class="new-btn w-full" @click="newTpl"><Plus :size="14" /> 新建提示词</button>
            </div>
            <div class="flex-1 overflow-auto py-1">
              <div v-if="loading" class="text-[12px] text-[#86909C] text-center py-8">加载中...</div>
              <div v-else-if="templates.length === 0" class="text-[12px] text-[#86909C] text-center py-8 px-3">暂无提示词，点击「新建」添加</div>
              <button v-for="t in templates" :key="t.id"
                class="tpl-item" :class="{ active: t.id === activeId }"
                @click="select(t)">
                <div class="truncate text-[13px]" style="color:#1D2129">{{ t.name }}</div>
                <div class="text-[11px] text-[#86909C] mt-0.5 truncate">
                  {{ t.content.slice(0, 40) }}{{ t.content.length > 40 ? '…' : '' }}
                </div>
              </button>
            </div>
          </div>

          <!-- 右侧编辑 -->
          <div :class="['flex-1 flex flex-col overflow-hidden',
                        mobileView === 'list' ? 'hidden sm:flex' : 'flex']">
            <div v-if="activeId === null && !isCreating"
              class="flex-1 flex items-center justify-center">
              <div class="text-center text-[#86909C]">
                <div class="text-5xl mb-3 opacity-20">✨</div>
                <div class="text-[14px]">选择提示词编辑，或点击「新建提示词」</div>
              </div>
            </div>

            <div v-else class="flex-1 overflow-auto px-6 py-5 space-y-4">
              <div>
                <label class="block text-[12px] text-[#86909C] mb-1.5">名称</label>
                <input v-model="form.name" class="form-input" placeholder="例如：客服风格、活泼少女" />
              </div>
              <div>
                <div class="flex items-center justify-between mb-1.5">
                  <label class="text-[12px] text-[#86909C]">提示词内容</label>
                  <span class="text-[11px] text-[#C9CDD4]">{{ form.content.length }} 字</span>
                </div>
                <textarea
                  v-model="form.content"
                  class="form-input"
                  style="min-height:200px;resize:none;line-height:1.7;"
                  placeholder="输入前置提示词内容，它将与默认的人设分析指令组合使用。&#10;&#10;例如：请特别注意分析说话人的幽默感和网络用语使用习惯，生成的人设要突出这两点特色。" />
              </div>

              <!-- 使用说明 -->
              <div class="rounded-[8px] p-3" style="background:#F7F8FA;border:1px solid #E5E6EB;">
                <div class="text-[11px] text-[#86909C] leading-relaxed">
                  此提示词会追加在系统默认的「人设分析指令」之前，用于引导 AI 侧重特定分析维度。
                </div>
              </div>

              <div v-if="errMsg" class="err-box">{{ errMsg }}</div>
            </div>

            <div v-if="activeId !== null || isCreating"
              class="px-6 py-4 border-t border-[#F2F3F5] bg-[#FAFBFC] flex items-center gap-2">
              <button class="btn btn-primary flex-1" :disabled="saving" @click="save">
                <Save :size="14" />
                {{ saving ? '保存中...' : (isCreating ? '创建' : '保存修改') }}
              </button>
              <button v-if="activeId !== null" class="btn btn-danger" :disabled="deleting" @click="del">
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
.back-btn { width:32px;height:32px;border-radius:8px;background:transparent;border:none;cursor:pointer;color:#4E5969;display:flex;align-items:center;justify-content:center;transition:all .15s;flex-shrink:0; }
.back-btn:hover { background:#F2F3F5; }
.close-btn:hover { background:#F2F3F5;color:#1D2129; }
.new-btn { height:36px;padding:0 12px;border-radius:8px;background:#4080FF;color:#fff;border:none;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;font-size:13px;transition:background .15s; }
.new-btn:hover { background:#2D6FED; }
.tpl-item { width:100%;display:flex;flex-direction:column;padding:10px 12px;text-align:left;background:transparent;border:none;cursor:pointer;transition:background .15s;gap:2px; }
.tpl-item:hover { background:rgba(255,255,255,.6); }
.tpl-item.active { background:#fff;box-shadow:inset 3px 0 0 #4080FF; }
.form-input { width:100%;padding:10px 12px;background:#fff;color:#1D2129;border:1px solid #E5E6EB;border-radius:8px;font-size:14px;outline:none;font-family:inherit;transition:border-color .15s,box-shadow .15s; }
.form-input:focus { border-color:#4080FF;box-shadow:0 0 0 3px rgba(64,128,255,.15); }
.err-box { padding:10px 12px;background:rgba(245,63,63,.08);border:1px solid rgba(245,63,63,.25);border-radius:8px;color:#F53F3F;font-size:13px; }
.btn { height:36px;padding:0 16px;border-radius:8px;font-size:13px;cursor:pointer;border:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;transition:all .15s; }
.btn:disabled { opacity:.6;cursor:not-allowed; }
.btn-primary { background:#4080FF;color:#fff; }
.btn-primary:hover:not(:disabled) { background:#2D6FED; }
.btn-danger { background:transparent;color:#F53F3F;border:1px solid rgba(245,63,63,.4); }
.btn-danger:hover:not(:disabled) { background:rgba(245,63,63,.08); }
.drawer-mask-enter-active,.drawer-mask-leave-active { transition:opacity .25s ease; }
.drawer-mask-enter-from,.drawer-mask-leave-to { opacity:0; }
.drawer-enter-active,.drawer-leave-active { transition:transform .3s cubic-bezier(.16,1,.3,1); }
.drawer-enter-from,.drawer-leave-to { transform:translateX(100%); }
</style>
