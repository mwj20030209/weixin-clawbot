<script setup lang="ts">
import { ref, reactive, watch, onMounted } from 'vue'
import { Plus, Save, Trash2, Zap, Eye, EyeOff, ChevronLeft } from 'lucide-vue-next'
import { apiUrl } from '../lib/api'

type Provider = {
  id: number
  name: string
  base_url: string
  model: string
  prompt: string
  is_active: number
}

const emit = defineEmits<{ (e: 'update:open', v: boolean): void }>()
const props = defineProps<{ open: boolean }>()

const mobileView = ref<'list' | 'form'>('list')

watch(() => props.open, (v) => { if (!v) mobileView.value = 'list' })

const providers  = ref<Provider[]>([])
const activeId   = ref<number | null>(null)
const isCreating = ref(false)
const loading    = ref(false)
const saving     = ref(false)
const deleting   = ref(false)
const switching  = ref(false)
const errMsg     = ref('')
const showKey    = ref(false)

const form = reactive({
  name: '', base_url: '', apiKey: '', model: '', prompt: '',
})

async function loadProviders() {
  loading.value = true
  try {
    providers.value = await fetch(apiUrl('/api/ai-providers')).then(r => r.json())
    if (providers.value.length && !activeId.value && !isCreating.value) {
      selectProvider(providers.value[0])
    }
  } finally { loading.value = false }
}

async function selectProvider(p: Provider) {
  activeId.value  = p.id
  isCreating.value = false
  mobileView.value = 'form'
  form.name     = p.name
  form.base_url = p.base_url
  form.model    = p.model
  form.prompt   = p.prompt ?? ''
  form.apiKey   = '加载中...'
  showKey.value = false
  errMsg.value  = ''
  // 拉取完整 key 填入输入框
  try {
    const r = await fetch(apiUrl(`/api/ai-providers/${p.id}/key`)).then(r => r.json())
    form.apiKey = r.fullKey ?? ''
  } catch { form.apiKey = '' }
}

function newProvider() {
  activeId.value   = null
  isCreating.value = true
  mobileView.value = 'form'
  form.name     = ''
  form.base_url = ''
  form.apiKey   = ''
  form.model    = ''
  form.prompt   = ''
  showKey.value = false
  errMsg.value  = ''
}

async function save() {
  if (!form.name.trim())     { errMsg.value = '请输入名称'; return }
  if (!form.base_url.trim()) { errMsg.value = '请输入 Base URL'; return }
  if (!form.model.trim())    { errMsg.value = '请输入模型名'; return }
  if (isCreating.value && !form.apiKey.trim()) { errMsg.value = '新建时需要填写 API Key'; return }

  saving.value = true; errMsg.value = ''
  try {
    const body = {
      name:    form.name.trim(),
      baseUrl: form.base_url.trim(),
      apiKey:  form.apiKey.trim(),
      model:   form.model.trim(),
      prompt:  form.prompt.trim(),
    }
    const url    = isCreating.value ? '/api/ai-providers' : `/api/ai-providers/${activeId.value}`
    const method = isCreating.value ? 'POST' : 'PUT'
    const res  = await fetch(apiUrl(url), { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json()
    if (!res.ok) { errMsg.value = data.error ?? '保存失败'; return }
    isCreating.value = false
    await loadProviders()
    // 选中刚保存的
    const newId = data.id ?? activeId.value
    const found = providers.value.find(p => p.id === newId)
    if (found) selectProvider(found)
  } finally { saving.value = false }
}

async function switchActive(p: Provider) {
  if (p.is_active) return
  switching.value = true
  try {
    await fetch(apiUrl(`/api/ai-providers/${p.id}/active`), { method: 'PATCH' })
    await loadProviders()
    const found = providers.value.find(x => x.id === p.id)
    if (found) selectProvider(found)
  } finally { switching.value = false }
}

async function del() {
  if (!activeId.value) return
  const p = providers.value.find(x => x.id === activeId.value)
  if (!p) return
  if (!confirm(`确定要删除「${p.name}」吗？`)) return
  deleting.value = true
  try {
    const res  = await fetch(apiUrl(`/api/ai-providers/${activeId.value}`), { method: 'DELETE' })
    const data = await res.json()
    if (!res.ok) { errMsg.value = data.error ?? '删除失败'; return }
    activeId.value = null
    await loadProviders()
    if (providers.value.length) selectProvider(providers.value[0])
  } finally { deleting.value = false }
}

watch(() => form.apiKey, () => { if (form.apiKey) showKey.value = false })
onMounted(loadProviders)
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
          <!-- 手机端返回按钮 -->
          <button v-if="mobileView === 'form'" class="sm:hidden back-btn" @click="mobileView = 'list'">
            <ChevronLeft :size="18" />
          </button>
          <div class="flex-1 min-w-0">
            <h2 class="text-[16px]" style="color:#1D2129">AI 模型配置</h2>
            <p class="text-[12px] text-[#86909C] mt-0.5 hidden sm:block">管理 AI 接口配置，可设置多个并切换使用</p>
          </div>
          <button class="close-btn" @click="emit('update:open', false)">✕</button>
        </div>

        <!-- Body -->
        <div class="flex flex-1 overflow-hidden flex-col sm:flex-row">

          <!-- 左侧列表 -->
          <div :class="['sm:flex flex-col w-full sm:w-[220px] sm:shrink-0 sm:border-r border-[#F2F3F5] bg-[#FAFBFC]',
                        mobileView === 'form' ? 'hidden sm:flex' : 'flex']">
            <div class="p-3 border-b border-[#F2F3F5]">
              <button class="new-btn w-full" @click="newProvider">
                <Plus :size="14" /> 新建配置
              </button>
            </div>
            <div class="flex-1 overflow-auto py-1">
              <div v-if="loading" class="text-[12px] text-[#86909C] text-center py-8">加载中...</div>
              <div v-else-if="providers.length === 0" class="text-[12px] text-[#86909C] text-center py-8">暂无配置</div>
              <button v-for="p in providers" :key="p.id"
                class="provider-item"
                :class="{ active: p.id === activeId }"
                @click="selectProvider(p)">
                <div class="flex items-center gap-2 min-w-0">
                  <span class="truncate text-[13px]" style="color:#1D2129">{{ p.name }}</span>
                  <span v-if="p.is_active" class="active-badge">使用中</span>
                </div>
                <div class="text-[11px] text-[#86909C] mt-0.5 text-left truncate">{{ p.model }}</div>
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
                <div class="text-5xl mb-3 opacity-20">🤖</div>
                <div class="text-[14px]">选择左侧配置进行编辑，或点击「新建配置」</div>
              </div>
            </div>

            <!-- 编辑表单 -->
            <div v-else class="flex-1 overflow-auto px-6 py-5 space-y-4">

              <!-- 当前使用提示 -->
              <div v-if="activeId !== null && providers.find(p => p.id === activeId)?.is_active"
                class="flex items-center gap-2 px-3 py-2 rounded-[8px] text-[12px]"
                style="background:rgba(0,180,42,.08);border:1px solid rgba(0,180,42,.2);color:#00b42a">
                <Zap :size="13" />
                当前正在使用此配置
              </div>

              <!-- 名称 -->
              <div>
                <label class="block text-[12px] text-[#86909C] mb-1.5">配置名称</label>
                <input v-model="form.name" class="form-input" placeholder="例如：DeepSeek生产、GPT备用" />
              </div>

              <!-- Base URL + 模型 -->
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label class="block text-[12px] text-[#86909C] mb-1.5">Base URL</label>
                  <input v-model="form.base_url" class="form-input" placeholder="https://api.deepseek.com" />
                </div>
                <div>
                  <label class="block text-[12px] text-[#86909C] mb-1.5">模型名</label>
                  <input v-model="form.model" class="form-input" placeholder="deepseek-v4-flash" />
                </div>
              </div>

              <!-- API Key -->
              <div>
                <div class="flex items-center justify-between mb-1.5">
                  <label class="text-[12px] text-[#86909C]">API Key</label>
                </div>
                <div class="relative">
                  <input
                    v-model="form.apiKey"
                    :type="showKey ? 'text' : 'password'"
                    class="form-input pr-10"
                    placeholder="sk-xxxxx"
                  />
                  <button class="absolute right-3 top-1/2 -translate-y-1/2 text-[#86909C] hover:text-[#4080FF]"
                    style="background:none;border:none;cursor:pointer;padding:0"
                    @click="showKey = !showKey">
                    <Eye v-if="!showKey" :size="16" />
                    <EyeOff v-else :size="16" />
                  </button>
                </div>
              </div>

              <!-- 默认 Prompt -->
              <div>
                <div class="flex items-center justify-between mb-1.5">
                  <label class="text-[12px] text-[#86909C]">默认 Prompt（可选）</label>
                  <span class="text-[11px] text-[#C9CDD4]">{{ form.prompt.length }} 字符</span>
                </div>
                <textarea
                  v-model="form.prompt"
                  class="form-input"
                  style="min-height:120px;resize:none;line-height:1.7;"
                  placeholder="未设置人设模板时使用此 Prompt 作为兜底角色设定（选填）" />
              </div>

              <!-- 错误提示 -->
              <div v-if="errMsg" class="err-box">{{ errMsg }}</div>

              <!-- 说明 -->
              <div class="rounded-[8px] p-3" style="background:#F7F8FA;border:1px solid #E5E6EB;">
                <div class="text-[11px] text-[#86909C] leading-relaxed">
                  支持任何 OpenAI Chat Completions 兼容接口（DeepSeek / DusAPI / OpenAI 等）
                </div>
                <div class="text-[11px] text-[#C9CDD4] mt-0.5">
                  Prompt 优先级：人设模板 &gt; 此默认 Prompt
                </div>
              </div>
            </div>

            <!-- 底部按钮 -->
            <div v-if="activeId !== null || isCreating"
              class="px-6 py-4 border-t border-[#F2F3F5] bg-[#FAFBFC] flex items-center gap-2">
              <button class="btn btn-primary flex-1" :disabled="saving" @click="save">
                <Save :size="14" />
                {{ saving ? '保存中...' : (isCreating ? '创建配置' : '保存修改') }}
              </button>
              <button
                v-if="activeId !== null && !providers.find(p => p.id === activeId)?.is_active"
                class="btn btn-switch" :disabled="switching"
                @click="switchActive(providers.find(p => p.id === activeId)!)">
                <Zap :size="14" />
                {{ switching ? '切换中...' : '切换使用' }}
              </button>
              <button v-if="activeId !== null && !providers.find(p => p.id === activeId)?.is_active"
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
  color:#4E5969;display:flex;align-items:center;justify-content:center;transition:all .15s;
}
.back-btn:hover { background:#F2F3F5; }

.new-btn {
  height:36px;padding:0 12px;border-radius:8px;
  background:#4080FF;color:#fff;border:none;cursor:pointer;
  display:inline-flex;align-items:center;justify-content:center;gap:6px;
  font-size:13px;transition:background .15s;
}
.new-btn:hover { background:#2D6FED; }

.provider-item {
  width:100%;display:block;padding:10px 12px;text-align:left;
  background:transparent;border:none;cursor:pointer;transition:background .15s;
}
.provider-item:hover { background:rgba(255,255,255,.6); }
.provider-item.active { background:#fff;box-shadow:inset 3px 0 0 #4080FF; }

.active-badge {
  padding:1px 6px;border-radius:20px;font-size:10px;font-weight:500;flex-shrink:0;
  background:rgba(0,180,42,.12);color:#00b42a;
}

.form-input {
  width:100%;padding:10px 12px;
  background:#fff;color:#1D2129;
  border:1px solid #E5E6EB;border-radius:8px;
  font-size:14px;outline:none;font-family:inherit;
  transition:border-color .15s,box-shadow .15s;
}
.form-input:focus { border-color:#4080FF;box-shadow:0 0 0 3px rgba(64,128,255,.15); }

.err-box {
  padding:10px 12px;background:rgba(245,63,63,.08);
  border:1px solid rgba(245,63,63,.25);border-radius:8px;
  color:#F53F3F;font-size:13px;
}

.btn {
  height:36px;padding:0 16px;border-radius:8px;font-size:13px;cursor:pointer;
  border:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;
  transition:all .15s;
}
.btn:disabled { opacity:.6;cursor:not-allowed; }
.btn-primary { background:#4080FF;color:#fff; }
.btn-primary:hover:not(:disabled) { background:#2D6FED; }
.btn-switch  { background:transparent;color:#00b42a;border:1px solid rgba(0,180,42,.4); }
.btn-switch:hover:not(:disabled) { background:rgba(0,180,42,.08); }
.btn-danger  { background:transparent;color:#F53F3F;border:1px solid rgba(245,63,63,.4); }
.btn-danger:hover:not(:disabled) { background:rgba(245,63,63,.08); }

.drawer-mask-enter-active,.drawer-mask-leave-active { transition:opacity .25s ease; }
.drawer-mask-enter-from,.drawer-mask-leave-to { opacity:0; }
.drawer-enter-active,.drawer-leave-active { transition:transform .3s cubic-bezier(.16,1,.3,1); }
.drawer-enter-from,.drawer-leave-to { transform:translateX(100%); }
</style>
