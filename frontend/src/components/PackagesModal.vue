<script setup lang="ts">
import { ref, reactive, watch } from 'vue'
import { Plus, Save, Trash2, Package, ChevronLeft } from 'lucide-vue-next'
import { apiUrl } from '../lib/api'

type Pkg = { id: number; name: string; quota: number; price: number; is_active: number; created_at: string }

const props = defineProps<{ open: boolean; token: string }>()
const emit  = defineEmits<{ (e: 'update:open', v: boolean): void }>()

const packages   = ref<Pkg[]>([])
const activeId   = ref<number | null>(null)
const isCreating = ref(false)
const loading    = ref(false)
const saving     = ref(false)
const deleting   = ref(false)
const errMsg     = ref('')
const mobileView = ref<'list' | 'form'>('list')

const form = reactive({ name: '', quota: 100, price: 9.9, isActive: true })

function authHeaders() {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${props.token}` }
}

async function loadPackages() {
  loading.value = true
  try {
    packages.value = await fetch(apiUrl('/api/packages'), { headers: authHeaders() }).then(r => r.json())
    if (packages.value.length && !activeId.value && !isCreating.value) selectPkg(packages.value[0])
  } finally { loading.value = false }
}

function selectPkg(p: Pkg) {
  activeId.value   = p.id
  isCreating.value = false
  mobileView.value = 'form'
  form.name     = p.name
  form.quota    = p.quota
  form.price    = Number(p.price)
  form.isActive = !!p.is_active
  errMsg.value  = ''
}

function newPkg() {
  activeId.value   = null
  isCreating.value = true
  mobileView.value = 'form'
  form.name     = ''
  form.quota    = 100
  form.price    = 9.9
  form.isActive = true
  errMsg.value  = ''
}

async function save() {
  if (!form.name.trim())    { errMsg.value = '请输入套餐名称'; return }
  if (form.quota <= 0)      { errMsg.value = '额度条数必须大于0'; return }
  if (form.price <= 0)      { errMsg.value = '价格必须大于0'; return }
  saving.value = true; errMsg.value = ''
  try {
    const body = { name: form.name.trim(), quota: form.quota, price: form.price, isActive: form.isActive }
    const url    = isCreating.value ? '/api/packages' : `/api/packages/${activeId.value}`
    const method = isCreating.value ? 'POST' : 'PUT'
    const res  = await fetch(apiUrl(url), { method, headers: authHeaders(), body: JSON.stringify(body) })
    const data = await res.json()
    if (!res.ok) { errMsg.value = data.error ?? '保存失败'; return }
    isCreating.value = false
    await loadPackages()
    const newId = data.id ?? activeId.value
    const found = packages.value.find(p => p.id === newId)
    if (found) selectPkg(found)
  } finally { saving.value = false }
}

async function del() {
  if (!activeId.value) return
  const p = packages.value.find(x => x.id === activeId.value)
  if (!p || !confirm(`确定要删除套餐「${p.name}」吗？`)) return
  deleting.value = true
  try {
    const res  = await fetch(apiUrl(`/api/packages/${activeId.value}`), { method: 'DELETE', headers: authHeaders() })
    const data = await res.json()
    if (!res.ok) { errMsg.value = data.error ?? '删除失败'; return }
    activeId.value = null; isCreating.value = false
    await loadPackages()
    if (packages.value.length) selectPkg(packages.value[0])
    else mobileView.value = 'list'
  } finally { deleting.value = false }
}

watch(() => props.open, v => {
  if (v) loadPackages()
  else mobileView.value = 'list'
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
        :style="{ width:'100%', maxWidth:'680px', borderLeft:'1px solid #F2F3F5' }">

        <div class="px-4 sm:px-6 py-4 sm:py-5 border-b border-[#F2F3F5] flex items-center justify-between gap-2">
          <button v-if="mobileView === 'form'" class="sm:hidden back-btn" @click="mobileView = 'list'">
            <ChevronLeft :size="18" />
          </button>
          <div class="flex-1 min-w-0">
            <h2 class="text-[16px]" style="color:#1D2129">套餐管理</h2>
            <p class="text-[12px] text-[#86909C] mt-0.5 hidden sm:block">创建和管理购买套餐，用户可购买套餐增加额度</p>
          </div>
          <button class="close-btn" @click="emit('update:open', false)">✕</button>
        </div>

        <div class="flex flex-1 overflow-hidden flex-col sm:flex-row">
          <!-- 左侧列表 -->
          <div :class="['sm:flex flex-col w-full sm:w-[220px] sm:shrink-0 sm:border-r border-[#F2F3F5] bg-[#FAFBFC]',
                        mobileView === 'form' ? 'hidden sm:flex' : 'flex']">
            <div class="p-3 border-b border-[#F2F3F5]">
              <button class="new-btn w-full" @click="newPkg">
                <Plus :size="14" /> 新建套餐
              </button>
            </div>
            <div class="flex-1 overflow-auto py-1">
              <div v-if="loading" class="text-[12px] text-[#86909C] text-center py-8">加载中...</div>
              <div v-else-if="packages.length === 0" class="text-[12px] text-[#86909C] text-center py-8">暂无套餐</div>
              <button v-for="p in packages" :key="p.id"
                class="pkg-item" :class="{ active: p.id === activeId }"
                @click="selectPkg(p)">
                <div class="flex items-center gap-2 min-w-0">
                  <Package :size="13" :style="{ color: p.is_active ? '#4080FF' : '#86909C', flexShrink: 0 }" />
                  <span class="truncate text-[13px]" style="color:#1D2129">{{ p.name }}</span>
                </div>
                <div class="text-[11px] text-[#86909C] mt-0.5 text-left">
                  {{ p.quota }} 条 · ¥{{ p.price }}
                </div>
                <span class="status-badge" :class="p.is_active ? 'on' : 'off'">{{ p.is_active ? '上架' : '下架' }}</span>
              </button>
            </div>
          </div>

          <!-- 右侧编辑 -->
          <div :class="['flex-1 flex flex-col overflow-hidden',
                        mobileView === 'list' ? 'hidden sm:flex' : 'flex']">
            <div v-if="activeId === null && !isCreating"
              class="flex-1 flex items-center justify-center">
              <div class="text-center text-[#86909C]">
                <div class="text-5xl mb-3 opacity-20">📦</div>
                <div class="text-[14px]">选择套餐进行编辑，或点击「新建套餐」</div>
              </div>
            </div>

            <div v-else class="flex-1 overflow-auto px-6 py-5 space-y-4">
              <div>
                <label class="block text-[12px] text-[#86909C] mb-1.5">套餐名称</label>
                <input v-model="form.name" class="form-input" placeholder="如：基础套餐、月度套餐" />
              </div>
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="block text-[12px] text-[#86909C] mb-1.5">额度条数</label>
                  <input v-model.number="form.quota" type="number" min="1" class="form-input" placeholder="100" />
                </div>
                <div>
                  <label class="block text-[12px] text-[#86909C] mb-1.5">价格（元）</label>
                  <input v-model.number="form.price" type="number" min="0.01" step="0.01" class="form-input" placeholder="9.90" />
                </div>
              </div>
              <div>
                <label class="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" v-model="form.isActive" class="w-4 h-4 rounded" style="accent-color:#4080FF" />
                  <span class="text-[13px]" style="color:#4E5969">上架（用户可见可购买）</span>
                </label>
              </div>
              <div v-if="errMsg" class="err-box">{{ errMsg }}</div>
            </div>

            <div v-if="activeId !== null || isCreating"
              class="px-6 py-4 border-t border-[#F2F3F5] bg-[#FAFBFC] flex items-center gap-2">
              <button class="btn btn-primary flex-1" :disabled="saving" @click="save">
                <Save :size="14" />
                {{ saving ? '保存中...' : (isCreating ? '创建套餐' : '保存修改') }}
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
.pkg-item { width:100%;display:flex;flex-direction:column;padding:10px 12px;text-align:left;background:transparent;border:none;cursor:pointer;transition:background .15s;gap:4px; }
.pkg-item:hover { background:rgba(255,255,255,.6); }
.pkg-item.active { background:#fff;box-shadow:inset 3px 0 0 #4080FF; }
.status-badge { font-size:10px;font-weight:500;padding:1px 6px;border-radius:20px;align-self:flex-start; }
.status-badge.on  { background:rgba(0,180,42,.12);color:#00B42A; }
.status-badge.off { background:rgba(134,144,156,.12);color:#86909C; }
.form-input { width:100%;padding:10px 12px;background:#fff;color:#1D2129;border:1px solid #E5E6EB;border-radius:8px;font-size:14px;outline:none;font-family:inherit;transition:border-color .15s,box-shadow .15s; }
.form-input:focus { border-color:#4080FF;box-shadow:0 0 0 3px rgba(64,128,255,.15); }
.err-box { padding:10px 12px;background:rgba(245,63,63,.08);border:1px solid rgba(245,63,63,.25);border-radius:8px;color:#F53F3F;font-size:13px; }
.btn { height:36px;padding:0 16px;border-radius:8px;font-size:13px;cursor:pointer;border:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;transition:all .15s; }
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
