<script setup lang="ts">
import { ref, reactive, watch } from 'vue'
import { Plus, Save, Trash2, CheckCircle, Eye, EyeOff, ChevronLeft, CreditCard } from 'lucide-vue-next'
import { apiUrl } from '../lib/api'

type WxPayConfig = {
  id: number
  name: string
  app_id: string
  mch_id: string
  key_path: string
  notify_url: string
  is_active: number
  created_at: string
}

const props = defineProps<{ open: boolean; token: string }>()
const emit  = defineEmits<{ (e: 'update:open', v: boolean): void }>()

const configs    = ref<WxPayConfig[]>([])
const activeId   = ref<number | null>(null)
const isCreating = ref(false)
const loading    = ref(false)
const saving     = ref(false)
const deleting   = ref(false)
const activating = ref(false)
const errMsg     = ref('')
const showKey    = ref(false)
const mobileView = ref<'list' | 'form'>('list')

const form = reactive({
  name: '', appId: '', appSecret: '', mchId: '', mchKey: '', keyPath: '', notifyUrl: '',
})

function authHeaders() {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${props.token}` }
}

async function load() {
  loading.value = true
  try {
    const data = await fetch(apiUrl('/api/wx-pay-configs'), { headers: authHeaders() }).then(r => r.json())
    configs.value = Array.isArray(data) ? data : []
    if (configs.value.length && activeId.value === null && !isCreating.value) {
      selectConfig(configs.value[0])
    }
  } finally { loading.value = false }
}

function selectConfig(c: WxPayConfig) {
  activeId.value   = c.id
  isCreating.value = false
  mobileView.value = 'form'
  form.name      = c.name
  form.appId     = c.app_id
  form.appSecret = ''   // 不回显 AppSecret
  form.mchId     = c.mch_id
  form.mchKey    = ''   // 不回显密钥
  form.keyPath   = c.key_path   || ''
  form.notifyUrl = c.notify_url || ''
  showKey.value  = false
  errMsg.value   = ''
}

function newConfig() {
  activeId.value   = null
  isCreating.value = true
  mobileView.value = 'form'
  form.name = form.appId = form.appSecret = form.mchId = form.mchKey = form.keyPath = form.notifyUrl = ''
  showKey.value = false
  errMsg.value = ''
}

async function save() {
  if (!form.name.trim())  { errMsg.value = '请输入配置名称'; return }
  if (!form.appId.trim()) { errMsg.value = '请输入 app_id'; return }
  if (!form.mchId.trim()) { errMsg.value = '请输入 mch_id'; return }
  if (isCreating.value && !form.mchKey.trim()) { errMsg.value = '新建时必须填写 mch_key'; return }
  saving.value = true; errMsg.value = ''
  try {
    const body = {
      name:      form.name.trim(),
      appId:     form.appId.trim(),
      appSecret: form.appSecret.trim(),
      mchId:     form.mchId.trim(),
      mchKey:    form.mchKey.trim(),
      keyPath:   form.keyPath.trim(),
      notifyUrl: form.notifyUrl.trim(),
    }
    const url    = isCreating.value ? '/api/wx-pay-configs' : `/api/wx-pay-configs/${activeId.value}`
    const method = isCreating.value ? 'POST' : 'PUT'
    const res  = await fetch(apiUrl(url), { method, headers: authHeaders(), body: JSON.stringify(body) })
    const data = await res.json()
    if (!res.ok) { errMsg.value = data.error ?? '保存失败'; return }
    isCreating.value = false
    await load()
    const newId = data.id ?? activeId.value
    const found = configs.value.find(c => c.id === newId)
    if (found) selectConfig(found)
  } finally { saving.value = false }
}

async function setActive(id: number) {
  activating.value = true
  try {
    await fetch(apiUrl(`/api/wx-pay-configs/${id}/active`), { method: 'PATCH', headers: authHeaders() })
    await load()
    const found = configs.value.find(c => c.id === id)
    if (found) selectConfig(found)
  } finally { activating.value = false }
}

async function del() {
  if (!activeId.value) return
  const c = configs.value.find(x => x.id === activeId.value)
  if (!c || !confirm(`确定要删除配置「${c.name}」吗？`)) return
  deleting.value = true
  try {
    const res  = await fetch(apiUrl(`/api/wx-pay-configs/${activeId.value}`), { method: 'DELETE', headers: authHeaders() })
    const data = await res.json()
    if (!res.ok) { errMsg.value = data.error ?? '删除失败'; return }
    activeId.value = null; isCreating.value = false
    await load()
    if (configs.value.length) selectConfig(configs.value[0])
    else mobileView.value = 'list'
  } finally { deleting.value = false }
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
            <CreditCard :size="18" style="color:#4080FF;flex-shrink:0" />
            <div>
              <h2 class="text-[16px]" style="color:#1D2129">微信支付配置</h2>
              <p class="text-[12px] text-[#86909C] mt-0.5 hidden sm:block">管理多个商家支付配置，设置其中一个为默认使用</p>
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
              <button class="new-btn w-full" @click="newConfig">
                <Plus :size="14" /> 新建配置
              </button>
            </div>
            <div class="flex-1 overflow-auto py-1">
              <div v-if="loading" class="text-[12px] text-[#86909C] text-center py-8">加载中...</div>
              <div v-else-if="configs.length === 0" class="text-[12px] text-[#86909C] text-center py-8 px-3 leading-relaxed">
                暂无支付配置<br/>点击「新建配置」添加
              </div>
              <button v-for="c in configs" :key="c.id"
                class="config-item"
                :class="{ active: c.id === activeId }"
                @click="selectConfig(c)">
                <div class="flex items-center gap-2 min-w-0">
                  <span class="truncate text-[13px]" style="color:#1D2129">{{ c.name }}</span>
                  <span v-if="c.is_active" class="active-badge">使用中</span>
                </div>
                <div class="text-[11px] text-[#86909C] mt-0.5 text-left truncate">{{ c.mch_id || c.app_id }}</div>
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
                <div class="text-5xl mb-3 opacity-20">💳</div>
                <div class="text-[14px]">选择左侧配置进行编辑，或点击「新建配置」</div>
              </div>
            </div>

            <!-- 编辑表单 -->
            <div v-else class="flex-1 overflow-auto px-6 py-5 space-y-4">

              <!-- 正在使用提示 -->
              <div v-if="activeId !== null && configs.find(c => c.id === activeId)?.is_active"
                class="flex items-center gap-2 px-3 py-2 rounded-[8px] text-[12px]"
                style="background:rgba(0,180,42,.08);border:1px solid rgba(0,180,42,.2);color:#00b42a">
                <CheckCircle :size="13" />
                当前正在使用此支付配置
              </div>

              <!-- 配置名称 -->
              <div>
                <label class="block text-[12px] text-[#86909C] mb-1.5">配置名称 <span class="text-red-400">*</span></label>
                <input v-model="form.name" class="form-input" placeholder="例如：商家A、测试商户" />
              </div>

              <!-- app_id + app_secret -->
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label class="block text-[12px] text-[#86909C] mb-1.5">app_id（微信AppID）<span class="text-red-400">*</span></label>
                  <input v-model="form.appId" class="form-input" placeholder="wx851c13bd9ee9e221" />
                </div>
                <div>
                  <label class="block text-[12px] text-[#86909C] mb-1.5">AppSecret（用于OAuth）</label>
                  <input v-model="form.appSecret" type="password" class="form-input" placeholder="留空则保持不变" />
                </div>
              </div>

              <!-- mch_id + mch_key -->
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label class="block text-[12px] text-[#86909C] mb-1.5">mch_id（商户号）<span class="text-red-400">*</span></label>
                  <input v-model="form.mchId" class="form-input" placeholder="1723112046" />
                </div>
                <div>
                  <label class="block text-[12px] text-[#86909C] mb-1.5">
                    mch_key（V2密钥，32位）
                    <span v-if="!isCreating" class="text-[10px] text-[#C9CDD4]">留空保持不变</span>
                    <span v-else class="text-red-400">*</span>
                  </label>
                  <div class="relative">
                    <input v-model="form.mchKey"
                      :type="showKey ? 'text' : 'password'"
                      class="form-input pr-10"
                      :placeholder="isCreating ? '32位字符串' : '留空则不修改'" />
                    <button class="absolute right-3 top-1/2 -translate-y-1/2 text-[#86909C] hover:text-[#4080FF]"
                      style="background:none;border:none;cursor:pointer;padding:0"
                      @click="showKey = !showKey">
                      <Eye v-if="!showKey" :size="16" />
                      <EyeOff v-else :size="16" />
                    </button>
                  </div>
                </div>
              </div>

              <!-- notify_url -->
              <div>
                <label class="block text-[12px] text-[#86909C] mb-1.5">notify_url（支付回调URL）</label>
                <input v-model="form.notifyUrl" class="form-input" placeholder="https://你的域名/api/wx-pay/notify" />
              </div>

              <!-- key_path -->
              <div>
                <label class="block text-[12px] text-[#86909C] mb-1.5">key_path（证书路径，选填）</label>
                <input v-model="form.keyPath" class="form-input" placeholder="/www/wwwroot/cert/apiclient_key.pem" />
              </div>

              <!-- 错误提示 -->
              <div v-if="errMsg" class="err-box">{{ errMsg }}</div>

              <!-- 说明 -->
              <div class="rounded-[8px] p-3" style="background:#F7F8FA;border:1px solid #E5E6EB;">
                <div class="text-[11px] text-[#86909C] leading-relaxed">
                  使用微信支付 JSAPI V2（MD5签名），通过 OAuth 静默授权获取 openid 后唤起支付弹窗。
                </div>
                <div class="text-[11px] text-[#C9CDD4] mt-1">
                  AppSecret 和 mch_key 加密保存，回显时为空，编辑时留空则保持不变。
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
                v-if="activeId !== null && !configs.find(c => c.id === activeId)?.is_active"
                class="btn btn-switch" :disabled="activating"
                @click="setActive(activeId!)">
                <CheckCircle :size="14" />
                {{ activating ? '切换中...' : '设为默认' }}
              </button>
              <button
                v-if="activeId !== null && !configs.find(c => c.id === activeId)?.is_active"
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

.config-item {
  width:100%;display:block;padding:10px 12px;text-align:left;
  background:transparent;border:none;cursor:pointer;transition:background .15s;
}
.config-item:hover { background:rgba(255,255,255,.6); }
.config-item.active { background:#fff;box-shadow:inset 3px 0 0 #4080FF; }

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
