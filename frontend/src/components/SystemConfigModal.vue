<script setup lang="ts">
import { ref, watch } from 'vue'
import { Save, Settings } from 'lucide-vue-next'
import { apiUrl } from '../lib/api'

const props = defineProps<{ open: boolean; token: string }>()
const emit  = defineEmits<{ (e: 'update:open', v: boolean): void }>()

type ConfigMap = Record<string, string>
const config  = ref<ConfigMap>({})
const loading = ref(false)
const saving  = ref<string | null>(null)
const errMsg  = ref('')
const sucMsg  = ref('')

function authHeaders() {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${props.token}` }
}

async function loadConfig() {
  loading.value = true
  try {
    config.value = await fetch(apiUrl('/api/system-config'), { headers: authHeaders() }).then(r => r.json())
  } finally { loading.value = false }
}

async function saveKey(key: string) {
  saving.value = key; errMsg.value = ''; sucMsg.value = ''
  try {
    const res  = await fetch(apiUrl('/api/system-config'), {
      method: 'PUT', headers: authHeaders(),
      body: JSON.stringify({ key, value: config.value[key] ?? '' }),
    })
    const data = await res.json()
    if (!res.ok) { errMsg.value = data.error ?? '保存失败'; return }
    sucMsg.value = '已保存'
    setTimeout(() => { sucMsg.value = '' }, 2000)
  } finally { saving.value = null }
}

watch(() => props.open, v => { if (v) loadConfig() })

const sections: { title: string; keys: { key: string; label: string; placeholder: string; textarea?: boolean }[] }[] = [
  {
    title: '用户注册设置',
    keys: [
      { key: 'default_register_quota', label: '新用户默认额度（条）', placeholder: '30' },
    ],
  },
  {
    title: '邀请奖励设置',
    keys: [
      { key: 'invite_threshold',   label: '邀请多少人触发奖励', placeholder: '3' },
      { key: 'invite_reward_quota', label: '每次奖励额度（条）',  placeholder: '200' },
    ],
  },
  {
    title: '续费提示',
    keys: [
      { key: 'quota_warning_url', label: '额度不足提示链接', placeholder: 'http://wxhot.xmhwl.cn' },
    ],
  },
  {
    title: '微信支付配置（JSAPI Pay V2）',
    keys: [
      { key: 'app_id',        label: 'app_id （微信AppID）',          placeholder: 'wx851c13bd9ee9e221' },
      { key: 'wx_app_secret', label: 'AppSecret （公众号）',       placeholder: '用于OAuth静默授权获取openid' },
      { key: 'mch_id',        label: 'mch_id （商户号）',          placeholder: '1723112046' },
      { key: 'mch_key',       label: 'mch_key （V2密钒，32位）',  placeholder: '微信V2密钒，32位字符串' },
      { key: 'key_path',      label: 'key_path （证书路径）',   placeholder: '/www/wwwroot/cert/apiclient_key.pem' },
      { key: 'notify_url',    label: 'notify_url （回调URL）',       placeholder: 'https://你的域名/api/wx-pay/notify' },
    ],
  },
]
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
          <div class="flex-1 min-w-0 flex items-center gap-2">
            <Settings :size="18" style="color:#4080FF;flex-shrink:0" />
            <div>
              <h2 class="text-[16px]" style="color:#1D2129">系统设置</h2>
              <p class="text-[12px] text-[#86909C] mt-0.5 hidden sm:block">配置注册额度、邀请奖励、微信支付参数</p>
            </div>
          </div>
          <button class="close-btn" @click="emit('update:open', false)">✕</button>
        </div>

        <div class="flex-1 overflow-auto px-4 sm:px-6 py-5">
          <div v-if="loading" class="text-center text-[#86909C] py-12">加载中...</div>
          <div v-else class="space-y-6">
            <div v-for="sec in sections" :key="sec.title" class="section-card">
              <h3 class="section-title">{{ sec.title }}</h3>
              <div class="space-y-3">
                <div v-for="item in sec.keys" :key="item.key">
                  <label class="block text-[12px] text-[#86909C] mb-1.5">{{ item.label }}</label>
                  <div class="flex gap-2">
                    <textarea v-if="item.textarea"
                      v-model="config[item.key]"
                      :placeholder="item.placeholder"
                      rows="5"
                      class="form-input flex-1 resize-none"
                      style="font-family:monospace;font-size:12px"
                    />
                    <input v-else
                      v-model="config[item.key]"
                      :placeholder="item.placeholder"
                      class="form-input flex-1"
                    />
                    <button class="btn btn-save" :disabled="saving === item.key" @click="saveKey(item.key)">
                      <Save :size="13" />{{ saving === item.key ? '保存中' : '保存' }}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div v-if="errMsg" class="mt-4 err-box">{{ errMsg }}</div>
          <div v-if="sucMsg" class="mt-4 suc-box">{{ sucMsg }}</div>
        </div>
      </aside>
    </Transition>
  </Teleport>
</template>

<style scoped>
.close-btn { width:32px;height:32px;border-radius:8px;background:transparent;border:none;cursor:pointer;color:#86909C;font-size:16px;transition:all .15s; }
.close-btn:hover { background:#F2F3F5;color:#1D2129; }
.section-card { background:#F7F8FA;border-radius:12px;padding:16px; }
.section-title { font-size:13px;font-weight:600;color:#1D2129;margin-bottom:12px; }
.form-input { padding:10px 12px;background:#fff;color:#1D2129;border:1px solid #E5E6EB;border-radius:8px;font-size:14px;outline:none;font-family:inherit;transition:border-color .15s,box-shadow .15s; }
.form-input:focus { border-color:#4080FF;box-shadow:0 0 0 3px rgba(64,128,255,.15); }
.btn { height:36px;padding:0 12px;border-radius:8px;font-size:13px;cursor:pointer;border:none;display:inline-flex;align-items:center;justify-content:center;gap:5px;transition:all .15s;flex-shrink:0; }
.btn:disabled { opacity:.6;cursor:not-allowed; }
.btn-save { background:#4080FF;color:#fff; }
.btn-save:hover:not(:disabled) { background:#2D6FED; }
.err-box { padding:10px 12px;background:rgba(245,63,63,.08);border:1px solid rgba(245,63,63,.25);border-radius:8px;color:#F53F3F;font-size:13px; }
.suc-box { padding:10px 12px;background:rgba(0,180,42,.08);border:1px solid rgba(0,180,42,.25);border-radius:8px;color:#00B42A;font-size:13px; }
.drawer-mask-enter-active,.drawer-mask-leave-active { transition:opacity .25s ease; }
.drawer-mask-enter-from,.drawer-mask-leave-to { opacity:0; }
.drawer-enter-active,.drawer-leave-active { transition:transform .3s cubic-bezier(.16,1,.3,1); }
.drawer-enter-from,.drawer-leave-to { transform:translateX(100%); }
</style>
