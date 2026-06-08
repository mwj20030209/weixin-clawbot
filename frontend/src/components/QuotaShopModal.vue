<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import QRCode from 'qrcode'
import { ShoppingCart, CheckCircle, RefreshCw, ArrowLeft, Zap, Star } from 'lucide-vue-next'
import { apiUrl } from '../lib/api'

type Pkg  = { id: number; name: string; quota: number; price: number; is_active: number }
type View = 'packages' | 'qr' | 'success'

const props = defineProps<{ open: boolean; token: string }>()
const emit  = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'quota-updated', quota: number): void
}>()

const view      = ref<View>('packages')
const packages  = ref<Pkg[]>([])
const loading   = ref(false)
const ordering  = ref<number | null>(null) // 正在下单的 pkg.id
const errMsg    = ref('')

const orderId    = ref('')
const orderName  = ref('')
const orderAmt   = ref(0)
const orderQuota = ref(0)
const codeUrl    = ref('')
const qrDataUrl  = ref('')
const newQuota   = ref(0)
let pollTimer: ReturnType<typeof setInterval> | null = null

function authHeaders() {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${props.token}` }
}

async function loadPackages() {
  loading.value = true; errMsg.value = ''
  try {
    const data: Pkg[] = await fetch(apiUrl('/api/packages'), { headers: authHeaders() }).then(r => r.json())
    packages.value = Array.isArray(data) ? data.filter(p => p.is_active) : []
  } catch (e: any) { errMsg.value = e.message }
  finally { loading.value = false }
}

// 计算最划算的套餐（单价最低）
const bestValueId = computed(() => {
  if (packages.value.length < 2) return -1
  let best = packages.value[0]
  for (const p of packages.value) {
    if (p.quota > 0 && (p.price / p.quota) < (best.price / best.quota)) best = p
  }
  return best.id
})
// 最热套餐（中间那个）
const hotId = computed(() => {
  if (packages.value.length < 2) return -1
  const mid = Math.floor(packages.value.length / 2)
  return packages.value[mid]?.id ?? -1
})

function unitPrice(p: Pkg) {
  if (!p.quota) return '—'
  const fen = Math.round((p.price / p.quota) * 100)
  return fen >= 100 ? `¥${(fen / 100).toFixed(2)}/条` : `${fen}分/条`
}

const CARD_GRADIENTS = [
  { from: '#4F8EF7', to: '#7B61FF' },
  { from: '#7B61FF', to: '#C850C0' },
  { from: '#F7734F', to: '#F5A623' },
  { from: '#20BF81', to: '#0C6FBF' },
  { from: '#667EEA', to: '#764BA2' },
]
function cardGradient(idx: number) {
  const c = CARD_GRADIENTS[idx % CARD_GRADIENTS.length]
  return `linear-gradient(135deg, ${c.from} 0%, ${c.to} 100%)`
}

async function buyPackage(pkg: Pkg) {
  ordering.value = pkg.id; errMsg.value = ''
  try {
    const res  = await fetch(apiUrl('/api/orders'), {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ packageId: pkg.id, payType: 'native' }),
    })
    const data = await res.json()
    if (!res.ok) { errMsg.value = data.error ?? '下单失败'; return }
    if (!data.codeUrl) { errMsg.value = '未获取到支付二维码，请联系管理员检查支付配置'; return }

    orderId.value    = data.orderId
    orderName.value  = data.name
    orderAmt.value   = data.amount
    orderQuota.value = data.quota
    codeUrl.value    = data.codeUrl
    qrDataUrl.value  = await QRCode.toDataURL(data.codeUrl, {
      width: 240, margin: 1,
      color: { dark: '#1D2129', light: '#FFFFFF' },
    })
    view.value = 'qr'
    startPolling()
  } catch (e: any) { errMsg.value = e.message }
  finally { ordering.value = null }
}

async function refreshQR() {
  if (!codeUrl.value) return
  qrDataUrl.value = await QRCode.toDataURL(codeUrl.value, {
    width: 240, margin: 1,
    color: { dark: '#1D2129', light: '#FFFFFF' },
  })
}

function startPolling() {
  stopPolling()
  pollTimer = setInterval(async () => {
    if (!orderId.value) return
    try {
      const data = await fetch(apiUrl(`/api/orders/${orderId.value}`), { headers: authHeaders() }).then(r => r.json())
      if (data.status === 'paid') {
        stopPolling()
        try {
          const me = await fetch(apiUrl('/api/auth/me'), { headers: authHeaders() }).then(r => r.json())
          newQuota.value = me.quota ?? 0
          emit('quota-updated', me.quota ?? 0)
        } catch {}
        view.value = 'success'
      }
    } catch {}
  }, 2500)
}
function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

function backToPackages() {
  stopPolling()
  view.value = 'packages'
  orderId.value = ''; codeUrl.value = ''; qrDataUrl.value = ''
  errMsg.value = ''
}

function close() {
  stopPolling()
  view.value = 'packages'
  orderId.value = ''; codeUrl.value = ''; qrDataUrl.value = ''
  errMsg.value = ''
  emit('update:open', false)
}

watch(() => props.open, v => {
  if (v) { view.value = 'packages'; loadPackages() }
  else stopPolling()
})
onUnmounted(() => stopPolling())
</script>

<template>
  <Teleport to="body">
    <!-- 遮罩 -->
    <Transition name="fade">
      <div v-if="open" class="fixed inset-0 z-[180] flex items-end sm:items-center justify-center"
        style="background:rgba(10,12,20,.6);backdrop-filter:blur(4px);"
        @click.self="close">

        <!-- 弹窗主体 -->
        <Transition name="modal-up">
          <div v-if="open" class="shop-modal" @click.stop>

            <!-- ── 套餐选择 ── -->
            <template v-if="view === 'packages'">
              <!-- 顶部渐变 banner -->
              <div class="shop-header">
                <button class="sh-close" @click="close">✕</button>
                <div class="sh-icon"><ShoppingCart :size="26" /></div>
                <div class="sh-title">购买聊天额度</div>
                <div class="sh-sub">一次充值，随时畅聊，额度永久有效</div>
              </div>

              <!-- 套餐列表 -->
              <div class="shop-body">
                <div v-if="loading" class="text-center text-[#86909C] py-10">
                  <div class="loading-dots"><span/><span/><span/></div>
                  <div class="mt-3 text-[13px]">加载套餐中...</div>
                </div>
                <div v-else-if="packages.length === 0"
                  class="text-center text-[#86909C] py-12">
                  <div class="text-5xl mb-3">📦</div>
                  <div class="text-[14px]">暂无可购买的套餐，请联系管理员</div>
                </div>
                <div v-else class="pkg-grid">
                  <div v-for="(pkg, idx) in packages" :key="pkg.id"
                    class="pkg-card"
                    :style="{ background: cardGradient(idx) }">
                    <!-- 标签 -->
                    <div class="pkg-tags">
                      <span v-if="pkg.id === bestValueId" class="tag tag-best">
                        <Zap :size="10" /> 最划算
                      </span>
                      <span v-else-if="pkg.id === hotId" class="tag tag-hot">
                        <Star :size="10" /> 热销
                      </span>
                    </div>
                    <div class="pkg-name">{{ pkg.name }}</div>
                    <div class="pkg-quota">
                      {{ pkg.quota.toLocaleString() }}
                      <span class="pkg-unit">条</span>
                    </div>
                    <div class="pkg-unit-price">{{ unitPrice(pkg) }}</div>
                    <div class="pkg-price">¥{{ pkg.price }}</div>
                    <button class="pkg-buy-btn"
                      :disabled="ordering !== null"
                      @click="buyPackage(pkg)">
                      <span v-if="ordering === pkg.id" class="btn-spinner" />
                      <span v-else>微信扫码购买</span>
                    </button>
                  </div>
                </div>
                <div v-if="errMsg" class="err-box mt-3">{{ errMsg }}</div>

                <!-- 底部说明 -->
                <div class="shop-footer-note">
                  🔒 微信支付 · 安全加密 · 支付后30秒内自动到账
                </div>
              </div>
            </template>

            <!-- ── 二维码支付 ── -->
            <template v-else-if="view === 'qr'">
              <div class="shop-header qr-header">
                <button class="sh-close" @click="close">✕</button>
                <button class="sh-back" @click="backToPackages">
                  <ArrowLeft :size="16" />
                </button>
                <div class="qr-order-badge">
                  <span class="qr-order-name">{{ orderName }}</span>
                  <span class="qr-order-price">¥{{ orderAmt }}</span>
                </div>
              </div>

              <div class="shop-body flex flex-col items-center gap-4 py-4">
                <!-- 二维码卡片 -->
                <div class="qr-card">
                  <div class="qr-wechat-bar">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="#07C160">
                      <path d="M9.5 3C6.46 3 4 5.46 4 8.5c0 1.61.68 3.06 1.76 4.09L3 15.37V19h3.63l2.78-2.76A5.49 5.49 0 0 0 9.5 16c3.04 0 5.5-2.46 5.5-5.5S12.54 3 9.5 3z"/>
                      <circle cx="9.5" cy="8.5" r="1.5"/>
                      <path d="M17.5 13c-2.49 0-4.5 2.01-4.5 4.5S15.01 22 17.5 22 22 19.99 22 17.5 19.99 13 17.5 13zm2.5 5h-2v2h-1v-2h-2v-1h2v-2h1v2h2v1z"/>
                    </svg>
                    <span>打开微信 → 扫一扫</span>
                  </div>
                  <div class="qr-img-wrap">
                    <img v-if="qrDataUrl" :src="qrDataUrl" alt="支付二维码"
                      class="qr-img" />
                    <div v-else class="qr-placeholder">
                      <RefreshCw :size="36" style="color:#C9CDD4" />
                    </div>
                  </div>
                  <div class="qr-waiting">
                    <div class="wait-dot" /><span>等待支付结果...</span>
                  </div>
                </div>

                <!-- 额度提示 -->
                <div class="qr-quota-tip">
                  支付成功后自动增加 <strong>{{ orderQuota }}</strong> 条额度
                </div>

                <!-- 操作按钮 -->
                <div class="flex gap-3 w-full max-w-[300px]">
                  <button class="qr-action-btn flex-1" @click="refreshQR">
                    <RefreshCw :size="13" /> 刷新二维码
                  </button>
                  <button class="qr-action-btn flex-1" @click="backToPackages">
                    <ArrowLeft :size="13" /> 换套餐
                  </button>
                </div>

                <div v-if="errMsg" class="err-box w-full max-w-[300px]">{{ errMsg }}</div>
              </div>
            </template>

            <!-- ── 支付成功 ── -->
            <template v-else-if="view === 'success'">
              <button class="sh-close absolute top-4 right-4 z-10" @click="close">✕</button>
              <div class="success-view">
                <div class="success-ring">
                  <CheckCircle :size="56" style="color:#07C160" />
                </div>
                <div class="success-title">支付成功 🎉</div>
                <div class="success-sub">
                  已购买「{{ orderName }}」<br/>
                  <span class="success-quota">+{{ orderQuota }}</span>
                  <span class="success-quota-label"> 条额度已到账</span>
                </div>
                <div v-if="newQuota > 0" class="success-total">
                  当前剩余：{{ newQuota }} 条
                </div>
                <div class="flex gap-3 mt-2">
                  <button class="success-btn success-btn-ghost" @click="close">关闭</button>
                  <button class="success-btn success-btn-primary" @click="backToPackages">再买一份</button>
                </div>
              </div>
            </template>

          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* ── 弹窗容器 ── */
.shop-modal {
  position:relative;
  width:100%;
  max-width:560px;
  background:#fff;
  border-radius:20px 20px 0 0;
  overflow:hidden;
  max-height:92vh;
  display:flex;
  flex-direction:column;
}
@media (min-width:640px) {
  .shop-modal {
    border-radius:20px;
    max-height:85vh;
  }
}

/* ── Header ── */
.shop-header {
  position:relative;
  background:linear-gradient(135deg,#4F8EF7 0%,#7B61FF 60%,#C850C0 100%);
  padding:28px 24px 24px;
  text-align:center;
  flex-shrink:0;
}
.qr-header { padding:20px 24px 16px; }
.sh-close {
  position:absolute; top:14px; right:14px;
  width:28px; height:28px; border-radius:50%;
  background:rgba(255,255,255,.22); border:none;
  color:#fff; font-size:14px; cursor:pointer; line-height:1;
  display:flex; align-items:center; justify-content:center;
  transition:background .15s;
}
.sh-close:hover { background:rgba(255,255,255,.35); }
.sh-back {
  position:absolute; top:14px; left:14px;
  width:28px; height:28px; border-radius:50%;
  background:rgba(255,255,255,.22); border:none; color:#fff;
  cursor:pointer; display:flex; align-items:center; justify-content:center;
  transition:background .15s;
}
.sh-back:hover { background:rgba(255,255,255,.35); }
.sh-icon { font-size:28px; margin-bottom:6px; color:rgba(255,255,255,.9); display:flex; justify-content:center; }
.sh-title { font-size:20px; font-weight:800; color:#fff; margin-bottom:4px; }
.sh-sub   { font-size:13px; color:rgba(255,255,255,.75); }

.qr-order-badge {
  display:inline-flex; align-items:center; gap:10px;
  background:rgba(255,255,255,.18); border-radius:20px;
  padding:6px 16px; margin-top:4px;
}
.qr-order-name  { font-size:13px; color:#fff; }
.qr-order-price { font-size:18px; font-weight:800; color:#FFE57A; }

/* ── Body ── */
.shop-body {
  flex:1; overflow-y:auto; padding:20px;
}

/* ── 套餐网格 ── */
.pkg-grid {
  display:grid;
  grid-template-columns:repeat(2,1fr);
  gap:12px;
}
@media (min-width:500px) {
  .pkg-grid { grid-template-columns:repeat(3,1fr); }
}

.pkg-card {
  border-radius:14px;
  padding:16px 12px;
  display:flex; flex-direction:column; align-items:center;
  gap:4px; text-align:center; position:relative;
  box-shadow:0 4px 16px rgba(0,0,0,.12);
  transition:transform .18s, box-shadow .18s;
  cursor:default;
}
.pkg-card:hover { transform:translateY(-3px); box-shadow:0 8px 24px rgba(0,0,0,.18); }

.pkg-tags {
  position:absolute; top:-8px; left:50%; transform:translateX(-50%);
  display:flex; gap:4px;
}
.tag { display:inline-flex; align-items:center; gap:3px; padding:2px 8px; border-radius:20px; font-size:10px; font-weight:700; white-space:nowrap; }
.tag-best { background:#FFE57A; color:#7B4F00; }
.tag-hot  { background:#FF6B6B; color:#fff; }

.pkg-name       { font-size:12px; color:rgba(255,255,255,.8); margin-top:4px; }
.pkg-quota      { font-size:34px; font-weight:900; color:#fff; line-height:1; margin:4px 0 0; }
.pkg-unit       { font-size:14px; font-weight:400; }
.pkg-unit-price { font-size:11px; color:rgba(255,255,255,.65); background:rgba(0,0,0,.15); border-radius:20px; padding:2px 8px; }
.pkg-price      { font-size:22px; font-weight:800; color:#FFE57A; }

.pkg-buy-btn {
  width:100%; height:38px; margin-top:4px;
  background:rgba(255,255,255,.25); border:1.5px solid rgba(255,255,255,.5);
  border-radius:10px; color:#fff; font-size:13px; font-weight:600;
  cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px;
  transition:all .15s;
}
.pkg-buy-btn:hover:not(:disabled) { background:rgba(255,255,255,.4); }
.pkg-buy-btn:disabled { opacity:.6; cursor:not-allowed; }

.btn-spinner {
  width:14px; height:14px; border-radius:50%;
  border:2px solid rgba(255,255,255,.4); border-top-color:#fff;
  animation:spin .8s linear infinite;
}

.shop-footer-note {
  text-align:center; font-size:12px; color:#86909C; margin-top:16px; padding-top:14px;
  border-top:1px solid #F2F3F5;
}

/* ── 二维码 ── */
.qr-card {
  background:#fff; border-radius:16px; padding:16px;
  box-shadow:0 2px 16px rgba(0,0,0,.08); border:1px solid #E5E6EB;
  display:flex; flex-direction:column; align-items:center; gap:12px;
  width:100%; max-width:300px;
}
.qr-wechat-bar {
  display:flex; align-items:center; gap:6px;
  font-size:13px; font-weight:600; color:#07C160;
}
.qr-img-wrap {
  border:3px solid #07C160; border-radius:12px; overflow:hidden;
  padding:2px; background:#fff;
}
.qr-img { width:220px; height:220px; display:block; }
.qr-placeholder {
  width:220px; height:220px; display:flex; align-items:center; justify-content:center;
  background:#F7F8FA;
}
.qr-waiting {
  display:flex; align-items:center; gap:8px;
  font-size:13px; color:#86909C;
}
.wait-dot {
  width:8px; height:8px; border-radius:50%; background:#07C160;
  animation:pulse-dot 1.2s ease-in-out infinite;
}
@keyframes pulse-dot {
  0%,100% { opacity:1; transform:scale(1); }
  50%      { opacity:.4; transform:scale(.7); }
}
.qr-quota-tip {
  background:rgba(7,193,96,.08); border:1px solid rgba(7,193,96,.2);
  border-radius:10px; padding:10px 18px;
  font-size:13px; color:#059C4D; text-align:center; width:100%; max-width:300px;
}
.qr-action-btn {
  height:36px; border-radius:9px; border:1px solid #E5E6EB;
  background:#F7F8FA; color:#4E5969; font-size:12px; cursor:pointer;
  display:inline-flex; align-items:center; justify-content:center; gap:5px;
  transition:all .15s;
}
.qr-action-btn:hover { border-color:#4080FF; color:#4080FF; background:#EEF3FF; }

/* ── 成功页 ── */
.success-view {
  display:flex; flex-direction:column; align-items:center;
  padding:32px 24px 28px; gap:12px; text-align:center;
}
.success-ring {
  width:88px; height:88px; border-radius:50%;
  background:radial-gradient(circle,rgba(7,193,96,.15) 0%,rgba(7,193,96,.05) 70%);
  display:flex; align-items:center; justify-content:center;
  animation:pop .4s cubic-bezier(.34,1.56,.64,1);
}
@keyframes pop {
  from { transform:scale(0); opacity:0; }
  to   { transform:scale(1); opacity:1; }
}
.success-title { font-size:22px; font-weight:800; color:#1D2129; }
.success-sub   { font-size:14px; color:#86909C; line-height:1.8; }
.success-quota { font-size:32px; font-weight:900; color:#07C160; }
.success-quota-label { font-size:14px; color:#07C160; }
.success-total { font-size:13px; color:#86909C; background:#F7F8FA; padding:6px 16px; border-radius:20px; }
.success-btn {
  height:40px; padding:0 24px; border-radius:10px; font-size:14px;
  font-weight:600; cursor:pointer; transition:all .15s; border:none;
}
.success-btn-ghost   { background:#F2F3F5; color:#4E5969; }
.success-btn-ghost:hover  { background:#E5E6EB; }
.success-btn-primary { background:#07C160; color:#fff; box-shadow:0 4px 12px rgba(7,193,96,.3); }
.success-btn-primary:hover { background:#059C4D; }

/* ── 通用 ── */
.err-box { padding:10px 12px; background:rgba(245,63,63,.08); border:1px solid rgba(245,63,63,.25); border-radius:8px; color:#F53F3F; font-size:13px; }

.loading-dots { display:flex; justify-content:center; gap:6px; }
.loading-dots span {
  width:8px; height:8px; border-radius:50%; background:#4080FF;
  animation:dot-bounce .8s ease-in-out infinite;
}
.loading-dots span:nth-child(2) { animation-delay:.15s; }
.loading-dots span:nth-child(3) { animation-delay:.3s; }
@keyframes dot-bounce {
  0%,80%,100% { transform:translateY(0); }
  40%         { transform:translateY(-8px); }
}

@keyframes spin { to { transform:rotate(360deg); } }

/* ── 过渡动画 ── */
.fade-enter-active, .fade-leave-active { transition:opacity .25s ease; }
.fade-enter-from, .fade-leave-to       { opacity:0; }
.modal-up-enter-active { transition:transform .35s cubic-bezier(.16,1,.3,1), opacity .25s ease; }
.modal-up-leave-active { transition:transform .2s ease, opacity .2s ease; }
.modal-up-enter-from   { transform:translateY(40px); opacity:0; }
.modal-up-leave-to     { transform:translateY(20px); opacity:0; }
@media (min-width:640px) {
  .modal-up-enter-from { transform:scale(.92) translateY(10px); }
  .modal-up-leave-to   { transform:scale(.95); }
}
</style>
