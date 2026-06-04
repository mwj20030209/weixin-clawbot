<script setup lang="ts">
import { ref, reactive, watch, onMounted } from 'vue'
import { Plus, Save, Trash2, Star, ChevronLeft } from 'lucide-vue-next'
import { apiUrl } from '../lib/api'

type Persona = { id: number; name: string; content: string; is_default: number }

const emit = defineEmits<{ (e: 'update:open', v: boolean): void }>()
const props = defineProps<{ open: boolean }>()

const mobileView = ref<'list' | 'form'>('list')
watch(() => props.open, (v) => { if (!v) mobileView.value = 'list' })

const personas   = ref<Persona[]>([])
const activeId   = ref<number | null>(null)
const isCreating = ref(false)
const loading    = ref(false)
const saving     = ref(false)
const deleting   = ref(false)
const errMsg     = ref('')

const form = reactive({ name: '', content: '', is_default: false })

// 当前选中
const active = () => personas.value.find(p => p.id === activeId.value) ?? null

async function loadPersonas() {
  loading.value = true
  try {
    personas.value = await fetch(apiUrl('/api/personas')).then(r => r.json())
    if (personas.value.length && !activeId.value) selectPersona(personas.value[0])
  } finally { loading.value = false }
}

function selectPersona(p: Persona) {
  activeId.value  = p.id
  isCreating.value = false
  mobileView.value = 'form'
  form.name       = p.name
  form.content    = p.content
  form.is_default = !!p.is_default
  errMsg.value    = ''
}

function newPersona() {
  activeId.value   = null
  isCreating.value = true
  mobileView.value = 'form'
  form.name        = ''
  form.content     = ''
  form.is_default  = false
  errMsg.value     = ''
}

async function save() {
  if (!form.name.trim()) { errMsg.value = '请输入人设名称'; return }
  if (!form.content.trim()) { errMsg.value = '请输入人设内容'; return }
  saving.value = true
  errMsg.value = ''
  try {
    if (activeId.value === null) {
      // 新建
      const res  = await fetch(apiUrl('/api/personas'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name.trim(), content: form.content.trim(), isDefault: form.is_default }),
      })
      const data = await res.json()
      if (!res.ok) { errMsg.value = data.error ?? '创建失败'; return }
        isCreating.value = false
    } else {
      // 更新
      const res = await fetch(apiUrl(`/api/personas/${activeId.value}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name.trim(), content: form.content.trim(), isDefault: form.is_default }),
      })
      const data = await res.json()
      if (!res.ok) { errMsg.value = data.error ?? '保存失败'; return }
    }
    await loadPersonas()
  } finally { saving.value = false }
}

async function setDefault(p: Persona) {
  await fetch(apiUrl(`/api/personas/${p.id}/default`), { method: 'PATCH' })
  await loadPersonas()
  selectPersona({ ...p, is_default: 1 })
}

async function del() {
  if (!activeId.value) return
  const p = active()
  if (!p) return
  if (!confirm(`确定要删除人设「${p.name}」吗？`)) return
  deleting.value = true
  try {
    const res  = await fetch(apiUrl(`/api/personas/${activeId.value}`), { method: 'DELETE' })
    const data = await res.json()
    if (!res.ok) { errMsg.value = data.error ?? '删除失败'; return }
    activeId.value = null
    await loadPersonas()
    if (personas.value.length) selectPersona(personas.value[0])
  } finally { deleting.value = false }
}

onMounted(loadPersonas)
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
        :style="{ width:'100%', maxWidth:'780px', borderLeft:'1px solid #F2F3F5' }">

        <!-- Header -->
        <div class="px-4 sm:px-6 py-4 sm:py-5 border-b border-[#F2F3F5] flex items-center justify-between gap-2">
          <button v-if="mobileView === 'form'" class="sm:hidden back-btn" @click="mobileView = 'list'">
            <ChevronLeft :size="18" />
          </button>
          <div class="flex-1 min-w-0">
            <h2 class="text-[16px]" style="color:#1D2129">人设库</h2>
            <p class="text-[12px] text-[#86909C] mt-0.5 hidden sm:block">管理可复用的 AI 人设模板，创建 Bot 时可选择套用</p>
          </div>
          <button class="close-btn" @click="emit('update:open', false)">✕</button>
        </div>

        <!-- Body: 左右布局 -->
        <div class="flex flex-1 overflow-hidden flex-col sm:flex-row">

          <!-- 左侧列表 -->
          <div :class="['sm:flex flex-col w-full sm:w-[220px] sm:shrink-0 sm:border-r border-[#F2F3F5] bg-[#FAFBFC]',
                        mobileView === 'form' ? 'hidden sm:flex' : 'flex']">
            <div class="p-3 border-b border-[#F2F3F5]">
              <button class="new-btn w-full" @click="newPersona">
                <Plus :size="14" /> 新建人设
              </button>
            </div>
            <div class="flex-1 overflow-auto py-1">
              <div v-if="loading" class="text-[12px] text-[#86909C] text-center py-8">加载中...</div>
              <div v-else-if="personas.length === 0" class="text-[12px] text-[#86909C] text-center py-8">暂无人设</div>
              <button v-for="p in personas" :key="p.id"
                class="persona-item"
                :class="{ active: p.id === activeId }"
                @click="selectPersona(p)"
              >
                <div class="flex items-center gap-2 min-w-0">
                  <span class="truncate text-[13px]" style="color:#1D2129">{{ p.name }}</span>
                  <span v-if="p.is_default" class="default-badge">默认</span>
                </div>
                <div class="text-[11px] text-[#86909C] mt-0.5 text-left truncate">
                  {{ p.content.slice(0, 28) }}{{ p.content.length > 28 ? '…' : '' }}
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
                <div class="text-5xl mb-3 opacity-20">🎭</div>
                <div class="text-[14px]">选择左侧人设进行编辑，或点击「新建人设」</div>
              </div>
            </div>

            <!-- 编辑表单 -->
            <div v-else class="flex-1 overflow-auto px-6 py-5 space-y-4">
              <div class="flex items-center gap-3">
                <div class="flex-1">
                  <label class="block text-[12px] text-[#86909C] mb-1.5">人设名称</label>
                  <input v-model="form.name" class="form-input" placeholder="例如：电商客服、技术答疑助手" />
                </div>
                <!-- 默认开关 -->
                <div class="mt-5 flex items-center gap-2">
                  <button class="icon-btn" :class="{ 'active-star': form.is_default }"
                    :title="form.is_default ? '取消默认' : '设为默认'"
                    @click="form.is_default = !form.is_default">
                    <Star :size="16" :fill="form.is_default ? '#FF7D00' : 'none'" />
                  </button>
                  <span class="text-[12px]" :style="{ color: form.is_default ? '#FF7D00' : '#86909C' }">
                    {{ form.is_default ? '默认人设' : '设为默认' }}
                  </span>
                </div>
              </div>

              <div>
                <div class="flex items-center justify-between mb-1.5">
                  <label class="text-[12px] text-[#86909C]">人设内容</label>
                  <span class="text-[11px] text-[#C9CDD4]">{{ form.content.length }} 字符</span>
                </div>
                <textarea
                  v-model="form.content"
                  class="form-input"
                  style="min-height:300px; resize:none; line-height:1.7;"
                  placeholder="描述这个人设的角色、性格、说话风格、专业领域、回复规则等...

例如：
你是一个专业的电商客服，熟悉商品退换货流程。
回复简洁礼貌，不重复套话。
遇到投诉先道歉再解决，不推卸责任。"
                />
              </div>

              <!-- 错误提示 -->
              <div v-if="errMsg" class="err-box">{{ errMsg }}</div>

              <!-- 底线说明 -->
              <div class="rounded-[8px] p-3" style="background:#F7F8FA; border:1px solid #E5E6EB;">
                <div class="text-[11px] text-[#86909C] leading-relaxed">
                  <span class="font-medium" style="color:#4E5969;">内置基础规范（始终叠加）：</span>
                  仅中文回复 · 禁止 Markdown · 回复简洁 · 不讨论违法内容
                </div>
                <div class="text-[11px] text-[#C9CDD4] mt-1">
                  最终 Prompt = 基础规范 + 【此模板内容】 + Bot 自定义补充
                </div>
              </div>
            </div>

            <!-- 底部按钮 -->
            <div v-if="form.name || form.content || activeId !== null || isCreating"
              class="px-6 py-4 border-t border-[#F2F3F5] bg-[#FAFBFC] flex items-center gap-2">
              <button class="btn btn-primary flex-1" :disabled="saving" @click="save">
                <Save :size="14" />
                {{ saving ? '保存中...' : (activeId === null ? '创建人设' : '保存修改') }}
              </button>
              <button v-if="activeId !== null && !active()?.is_default"
                class="btn btn-ghost" @click="setDefault(active()!)">
                <Star :size="14" /> 设为默认
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
  height:36px;padding:0 12px;border-radius:8px;
  background:#4080FF;color:#fff;border:none;cursor:pointer;
  display:inline-flex;align-items:center;justify-content:center;gap:6px;
  font-size:13px;transition:background .15s;
}
.new-btn:hover { background:#2D6FED; }

.persona-item {
  width:100%;display:block;padding:10px 12px;text-align:left;
  background:transparent;border:none;cursor:pointer;transition:background .15s;
}
.persona-item:hover { background:rgba(255,255,255,.6); }
.persona-item.active { background:#fff;box-shadow:inset 3px 0 0 #4080FF; }

.default-badge {
  padding:1px 6px;border-radius:20px;font-size:10px;font-weight:500;
  background:rgba(255,125,0,.12);color:#FF7D00;flex-shrink:0;
}

.form-input {
  width:100%;padding:10px 12px;
  background:#fff;color:#1D2129;
  border:1px solid #E5E6EB;border-radius:8px;
  font-size:14px;outline:none;font-family:inherit;
  transition:border-color .15s,box-shadow .15s;
}
.form-input:focus { border-color:#4080FF;box-shadow:0 0 0 3px rgba(64,128,255,.15); }

.icon-btn {
  width:32px;height:32px;border-radius:8px;background:#F7F8FA;
  border:1px solid #E5E6EB;cursor:pointer;display:flex;align-items:center;
  justify-content:center;transition:all .15s;
}
.icon-btn:hover,.icon-btn.active-star { background:rgba(255,125,0,.1);border-color:#FF7D00; }

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
.btn-ghost   { background:transparent;color:#4E5969;border:1px solid #E5E6EB; }
.btn-ghost:hover { background:#F7F8FA; }
.btn-danger  { background:transparent;color:#F53F3F;border:1px solid rgba(245,63,63,.4); }
.btn-danger:hover:not(:disabled) { background:rgba(245,63,63,.08); }

/* transitions */
.drawer-mask-enter-active,.drawer-mask-leave-active { transition:opacity .25s ease; }
.drawer-mask-enter-from,.drawer-mask-leave-to { opacity:0; }
.drawer-enter-active,.drawer-leave-active { transition:transform .3s cubic-bezier(.16,1,.3,1); }
.drawer-enter-from,.drawer-leave-to { transform:translateX(100%); }
</style>
