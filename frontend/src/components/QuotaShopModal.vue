<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { ShoppingCart, CheckCircle, RefreshCw, AlertCircle } from 'lucide-vue-next'
import { apiUrl } from '../lib/api'

type Pkg = { id: number; name: string; quota: number; price: number; is_active: number }

const props = defineProps<{ open: boolean; token: string }>()
const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'quota-updated', quota: number): void
}>()

// 判断是否在微信浏览器
const isWechat = /MicroMessenger/i.test(navigator.userAgent)
// openid 从 localStorage 读取
const wxOpenid = ref(localStorage.getItem('wx_openid') || '')

const packages    = ref<Pkg[]>([])
const loading     = ref(false)
const ordering    = ref(false)
const errMsg      = ref('')
const statusMsg   = ref('')

// 当前订单
const orderId    = ref<string | null>(null)
const orderName  = ref('')
const orderAmt   = ref(0)
const orderQuota = ref(0)
const orderStatus = ref<'pending' | 'paid' | null>(null)
let pollTimer: ReturnType<typeof setInterval> | null = null

function authHeaders() {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${props.token}` }
}

async function loadPackages() {
  loading.value = true; errMsg.value = ''
  try {
    const data: Pkg[] = await fetch(apiUrl('/api/packages'), { headers: authHeaders() }).then(r => r.json())
    packages.value = data.filter(p => p.is_active)
  } catch (e: any) { errMsg.value = e.message }
  finally { loading.value = false }
}

// ========== OAuth 授权获取 openid ==========
async function requestOAuth() {
  errMsg.value = ''
  try {
    const redirectUri = encodeURIComponent(window.location.href.split('?')[0])
    const res  = await fetch(apiUrl(`/api/wx-oauth/url?redirect=${redirectUri}`), { headers: authHeaders() })
    const data = await res.json()
    if (!res.ok) { errMsg.value = data.error ?? '获取授权链接失败'; return }
    // 保存意图，OAuth回来后自动打开
    localStorage.setItem('wx_pay_pending', '1')
    window.location.href = data.url
  } catch (e: any) { errMsg.value = e.message }
}

// ========== WeixinJSBridge 调用支付 ==========
function waitForBridge(): Promise<void> {
  return new Promise((resolve) => {
    if ((window as any).WeixinJSBridge) {
      resolve()
    } else {
      document.addEventListener('WeixinJSBridgeReady', () => resolve(), false)
    }
  })
}

function invokePay(params: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    ;(window as any).WeixinJSBridge.invoke('getBrandWCPayRequest', {
      appId:     params.appId,
      timeStamp: params.timeStamp,
      nonceStr:  params.nonceStr,
      package:   params.package,
      signType:  params.signType,
      paySign:   params.paySign,
    }, (res: any) => {
      if (res.err_msg === 'get_brand_wcpay_request:ok')      resolve()
      else if (res.err_msg === 'get_brand_wcpay_request:cancel') reject(new Error('已取消支付'))
      else reject(new Error(res.err_msg || '支付失败'))
    })
  })
}

// ========== 下单 & 支付 ==========
async function buyPackage(pkg: Pkg) {
  if (!wxOpenid.value) { await requestOAuth(); return }
  ordering.value = true; errMsg.value = ''; statusMsg.value = '正在创建订单...'
  try {
    const res  = await fetch(apiUrl('/api/orders'), {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ packageId: pkg.id, openid: wxOpenid.value }),
    })
    const data = await res.json()
    if (!res.ok) {
      // openid 失效，重新授权
      if (res.status === 400 && data.error?.includes('openid')) {
        localStorage.removeItem('wx_openid'); wxOpenid.value = ''
        await requestOAuth()
      } else { errMsg.value = data.error ?? '下单失败' }
      return
    }
    orderId.value    = data.orderId
    orderName.value  = data.name
    orderAmt.value   = data.amount
    orderQuota.value = data.quota
    orderStatus.value = 'pending'

    if (!data.jsapiParams) {
      errMsg.value = '微信支付参数获取失败，请联系管理员检查支付配置'
      ordering.value = false; statusMsg.value = ''
      return
    }

    statusMsg.value = '正在唤起支付...'
    await waitForBridge()
    await invokePay(data.jsapiParams)

    // 支付成功
    statusMsg.value = '支付成功，正在确认...'
    startPolling()
  } catch (e: any) {
    errMsg.value = e.message
    orderId.value = null; orderStatus.value = null
    statusMsg.value = ''
  } finally { ordering.value = false }
}

function startPolling() {
  stopPolling()
  pollTimer = setInterval(async () => {
    if (!orderId.value) return
    try {
      const res  = await fetch(apiUrl(`/api/orders/${orderId.value}`), { headers: authHeaders() })
      const data = await res.json()
      if (data.status === 'paid') {
        orderStatus.value = 'paid'
        statusMsg.value   = ''
        stopPolling()
        try {
          const me = await fetch(apiUrl('/api/auth/me'), { headers: authHeaders() }).then(r => r.json())
          emit('quota-updated', me.quota ?? 0)
        } catch {}
      }
    } catch {}
  }, 2500)
}
function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

function resetAuth() {
  localStorage.removeItem('wx_openid')
  wxOpenid.value = ''
  errMsg.value   = ''
}
function resetOrder() {
  orderId.value = null; orderStatus.value = null; statusMsg.value = ''; errMsg.value = ''
  stopPolling()
}
function close() { resetOrder(); emit('update:open', false) }

watch(() => props.open, v => {
  if (v) {
    // 检查是否有未处理的 openid 刷新（OAuth 回调后）
    const pending = localStorage.getItem('wx_openid')
    if (pending) wxOpenid.value = pending
    loadPackages()
  } else { resetOrder() }
})
onUnmounted(() => stopPolling())
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer-mask">
      <div v-if="open" class="fixed inset-0 z-[180]"
        style="background:rgba(29,33,41,.35);backdrop-filter:blur(2px);"
        @click="close" />
    </Transition>

    <Transition name="drawer">
      <aside v-if="open" class="fixed top-0 right-0 bottom-0 z-[181] bg-white flex flex-col"
        :style="{ width:'100%', maxWidth:'640px', borderLeft:'1px solid #F2F3F5' }">

        <!-- Header -->
        <div class="px-4 sm:px-6 py-4 sm:py-5 border-b border-[#F2F3F5] flex items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <ShoppingCart :size="18" style="color:#4080FF;flex-shrink:0" />
            <div>
              <h2 class="text-[16px]" style="color:#1D2129">购买额度</h2>
              <p class="text-[12px] text-[#86909C] mt-0.5 hidden sm:block">在微信中购买套餐，支付后额度自动到账</p>
            </div>
          </div>
          <button class="close-btn" @click="close">✕</button>
        </div>

        <div class="flex-1 overflow-auto px-4 sm:px-6 py-5">

          <!-- 非微信浏览器提示 -->
          <div v-if="!isWechat" class="flex flex-col items-center gap-4 py-14 text-center">
            <AlertCircle :size="48" style="color:#F7BA1E;opacity:.8" />
            <div class="text-[16px] font-semibold" style="color:#1D2129">请在微信中打开此页面</div>
            <div class="text-[13px] text-[#86909C] max-w-[260px]">
              JSAPI 支付仅支持在微信浏览器内使用，请将链接分享到微信后打开
            </div>
          </div>

          <!-- 支付成功 -->
          <div v-else-if="orderStatus === 'paid'" class="flex flex-col items-center justify-center py-16 gap-4">
            <CheckCircle :size="64" style="color:#00B42A" />
            <div class="text-[20px] font-semibold" style="color:#1D2129">支付成功！</div>
            <div class="text-[13px] text-[#86909C]">已购买「{{ orderName }}」，增加 {{ orderQuota }} 条额度</div>
            <button class="buy-btn" style="width:160px;margin-top:8px" @click="resetOrder">继续购买</button>
          </div>

          <!-- 微信中但未授权 -->
          <div v-else-if="isWechat && !wxOpenid" class="flex flex-col items-center gap-4 py-14 text-center">
            <div class="text-[40px]">🔐</div>
            <div class="text-[16px] font-semibold" style="color:#1D2129">需要微信授权</div>
            <div class="text-[13px] text-[#86909C] max-w-[260px]">
              为了使用微信支付，需要先授权获取您的微信身份
            </div>
            <button class="buy-btn" style="width:180px" @click="requestOAuth">
              微信授权登录
            </button>
            <div v-if="errMsg" class="err-box w-full">{{ errMsg }}</div>
          </div>

          <!-- 套餐列表 -->
          <div v-else-if="isWechat && wxOpenid">
            <div v-if="loading" class="text-center text-[#86909C] py-12">加载中...</div>
            <div v-else-if="packages.length === 0" class="text-center text-[#86909C] py-12">
              <div class="text-4xl mb-3">📦</div>
              <div>暂无可购买的套餐，请联系管理员添加</div>
            </div>
            <div v-else>
              <p class="text-[13px] text-[#86909C] mb-4">选择套餐后将直接唤起微信支付，无需扫码</p>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div v-for="pkg in packages" :key="pkg.id" class="pkg-card">
                  <div class="pkg-name">{{ pkg.name }}</div>
                  <div class="pkg-quota">{{ pkg.quota }} <span class="text-[14px] font-normal text-[#86909C]">条</span></div>
                  <div class="pkg-price">¥{{ pkg.price }}</div>
                  <button class="buy-btn" :disabled="ordering" @click="buyPackage(pkg)">
                    <span v-if="ordering && statusMsg">{{ statusMsg }}</span>
                    <span v-else>立即支付</span>
                  </button>
                </div>
              </div>
            </div>

            <div v-if="errMsg" class="mt-4 err-box">{{ errMsg }}</div>

            <!-- 重新授权 -->
            <div class="mt-4 pt-4 border-t border-[#F2F3F5] text-center">
              <button class="text-[12px] text-[#86909C] hover:text-[#4080FF]" @click="resetAuth">
                更换微信账号 / 重新授权
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
.pkg-card { background:#F7F8FA;border-radius:14px;padding:20px;border:2px solid transparent;display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center;transition:all .2s; }
.pkg-card:hover { border-color:#4080FF;background:#EEF3FF; }
.pkg-name  { font-size:15px;font-weight:600;color:#1D2129; }
.pkg-quota { font-size:36px;font-weight:700;color:#4080FF;line-height:1; }
.pkg-price { font-size:20px;font-weight:600;color:#F53F3F; }
.buy-btn {
  width:100%;height:42px;background:#4080FF;color:#fff;border:none;border-radius:10px;
  font-size:14px;font-weight:500;cursor:pointer;margin-top:4px;
  box-shadow:0 4px 12px rgba(64,128,255,.25);transition:background .15s,transform .1s;
}
.buy-btn:hover:not(:disabled) { background:#2D6FED; }
.buy-btn:active:not(:disabled) { transform:translateY(1px); }
.buy-btn:disabled { opacity:.7;cursor:not-allowed; }
.err-box { padding:10px 12px;background:rgba(245,63,63,.08);border:1px solid rgba(245,63,63,.25);border-radius:8px;color:#F53F3F;font-size:13px; }
.drawer-mask-enter-active,.drawer-mask-leave-active { transition:opacity .25s ease; }
.drawer-mask-enter-from,.drawer-mask-leave-to { opacity:0; }
.drawer-enter-active,.drawer-leave-active { transition:transform .3s cubic-bezier(.16,1,.3,1); }
.drawer-enter-from,.drawer-leave-to { transform:translateX(100%); }
</style>
