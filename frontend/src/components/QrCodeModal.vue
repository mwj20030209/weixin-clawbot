<script setup lang="ts">
import { ref, watch, onBeforeUnmount, computed, nextTick } from 'vue'
import { RefreshCw, CheckCircle2 } from 'lucide-vue-next'
import BaseModal from './BaseModal.vue'
import type { Bot } from './BotCard.vue'
import QRCode from 'qrcode'

const props = defineProps<{ open: boolean; bot: Bot | null }>()
const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'refresh'): void
}>()

const seconds  = ref(120)
const success  = ref(false)
const canvasEl = ref<HTMLCanvasElement | null>(null)
const qrError  = ref('')
let timer: number | null = null

function start() {
  seconds.value = 120
  success.value = false
  stop()
  timer = window.setInterval(() => {
    if (seconds.value > 0) seconds.value--
  }, 1000)
}
function stop() {
  if (timer) { clearInterval(timer); timer = null }
}

async function renderQr() {
  qrError.value = ''
  const url = props.bot?.qrcodeUrl
  if (!url) return
  await nextTick()
  if (!canvasEl.value) return
  try {
    await QRCode.toCanvas(canvasEl.value, url, {
      width: 194,
      margin: 1,
      color: { dark: '#1D2129', light: '#ffffff' },
    })
  } catch (e: any) {
    qrError.value = '二维码生成失败：' + (e?.message ?? e)
  }
}

watch(
  () => [props.open, props.bot?.qrcodeUrl] as const,
  ([open]) => {
    if (open) { start(); renderQr() }
    else stop()
  }
)
onBeforeUnmount(stop)

const expired = computed(() => seconds.value === 0)
</script>

<template>
  <BaseModal :open="open" width="400px" @update:open="emit('update:open', $event)">
    <template v-if="bot">
      <div class="px-6 pt-6 pb-2 text-center">
        <div style="color:#1D2129">{{ bot.name }}</div>
        <div class="text-[13px] text-[#86909C] mt-1">请用微信扫描下方二维码登录</div>
      </div>

      <div class="px-6 py-5 flex flex-col items-center gap-4">
        <!-- 登录成功 -->
        <div
          v-if="success"
          class="w-[220px] h-[220px] flex flex-col items-center justify-center rounded-[12px] bg-[#F0F9EB]"
        >
          <CheckCircle2 :size="56" :style="{ color: '#4080FF' }" />
          <div class="mt-3" style="color:#1D2129">登录成功</div>
        </div>

        <!-- 二维码区域 -->
        <div
          v-else
          class="qr-frame relative w-[220px] h-[220px] rounded-[12px] border border-[#E5E6EB] bg-white flex items-center justify-center overflow-hidden"
        >
          <!-- 无 URL -->
          <div v-if="!bot.qrcodeUrl" class="text-[12px] text-[#86909C]">等待获取二维码…</div>
          <!-- 生成失败 -->
          <div v-else-if="qrError" class="px-3 text-center text-[12px]" style="color:#F53F3F">{{ qrError }}</div>
          <!-- canvas 二维码 -->
          <div v-else :style="{ opacity: expired ? 0.25 : 1, transition: 'opacity .3s' }">
            <canvas ref="canvasEl" />
          </div>

          <!-- 过期遮罩 -->
          <div v-if="expired" class="absolute inset-0 flex items-center justify-center" style="background:rgba(255,255,255,.6)">
            <div class="px-3 py-1.5 rounded-full text-[12px] text-white" style="background:rgba(29,33,41,.8)">
              二维码已过期
            </div>
          </div>

          <!-- 扫描线 -->
          <div v-if="!expired && bot.qrcodeUrl && !qrError" class="scan-line" />
        </div>

        <!-- 状态文字 -->
        <div v-if="!success" class="flex items-center gap-1.5">
          <span
            class="w-1.5 h-1.5 rounded-full pulse-dot"
            :style="{ background: expired ? '#F53F3F' : '#FF7D00' }"
          />
          <span class="text-[13px]" :style="{ color: expired ? '#F53F3F' : '#4E5969' }">
            {{ expired ? '扫码已超时' : '等待扫码中…' }}
          </span>
        </div>
      </div>

      <div class="px-6 py-4 bg-[#FAFBFC] border-t border-[#F2F3F5] flex items-center justify-between">
        <span class="text-[12px]" :style="{ color: expired ? '#F53F3F' : '#86909C' }">
          {{ expired ? '已过期' : `${seconds}s 后失效` }}
        </span>
        <button class="refresh-btn" @click="emit('refresh'); start(); renderQr()">
          <RefreshCw :size="14" /> 刷新二维码
        </button>
      </div>
    </template>
  </BaseModal>
</template>

<style scoped>
.scan-line {
  position:absolute; left:12px; right:12px; height:2px; border-radius:2px;
  background: linear-gradient(90deg, transparent, #4080FF, transparent);
  animation: scan 2s ease-in-out infinite alternate;
  pointer-events: none;
}
@keyframes scan {
  from { top: 12px; }
  to   { top: 196px; }
}

.pulse-dot { animation: pulseDot 1.4s ease-in-out infinite; }
@keyframes pulseDot {
  0%,100% { opacity:1; }
  50%     { opacity:.3; }
}

.refresh-btn {
  display:inline-flex; align-items:center; gap:6px;
  height:32px; padding:0 12px; border-radius:8px;
  font-size:13px; color:#4080FF;
  background:transparent; border:none; cursor:pointer;
  transition: background .15s;
}
.refresh-btn:hover { background: rgba(64,128,255,.10); }
</style>

