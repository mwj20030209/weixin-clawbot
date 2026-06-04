<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'
import { Sparkles, ChevronDown } from 'lucide-vue-next'
import { apiUrl } from '../lib/api'

type Template = { id: number; name: string; content: string }

const props = defineProps<{ open: boolean; token: string }>()
const emit  = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'generated', persona: string): void
}>()

const chatContent     = ref('')
const selectedTplId   = ref<number | 'none'>('none')
const templates       = ref<Template[]>([])
const generating      = ref(false)
const errMsg          = ref('')
const tplLoading      = ref(false)
const loadingTip      = ref('')

// 加载中提示语轮播
const TIPS = [
  '正在分析聊天风格...',
  '提炼说话习惯中...',
  '归纳语气特征...',
  '生成个性化人设...',
  '快好了，稍等一下...',
]
let tipTimer: ReturnType<typeof setInterval> | null = null

function startTips() {
  let i = 0
  loadingTip.value = TIPS[0]
  tipTimer = setInterval(() => {
    i = (i + 1) % TIPS.length
    loadingTip.value = TIPS[i]
  }, 2200)
}
function stopTips() {
  if (tipTimer) { clearInterval(tipTimer); tipTimer = null }
  loadingTip.value = ''
}
onUnmounted(stopTips)

function authHeaders() {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${props.token}` }
}

async function loadTemplates() {
  tplLoading.value = true
  try {
    templates.value = await fetch(apiUrl('/api/prompt-templates'), { headers: authHeaders() }).then(r => r.json())
  } catch {}
  tplLoading.value = false
}

watch(() => props.open, v => {
  if (v) {
    loadTemplates()
    chatContent.value   = ''
    selectedTplId.value = 'none'
    errMsg.value        = ''
  } else {
    stopTips()
  }
})

async function generate() {
  if (!chatContent.value.trim()) { errMsg.value = '请先粘贴聊天记录'; return }
  generating.value = true
  errMsg.value     = ''
  startTips()
  try {
    const prePrompt = selectedTplId.value !== 'none'
      ? templates.value.find(t => t.id === selectedTplId.value)?.content ?? ''
      : ''
    const res  = await fetch(apiUrl('/api/generate-persona'), {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ chatContent: chatContent.value.trim(), prePrompt }),
    })
    const data = await res.json()
    if (!res.ok) { errMsg.value = data.error ?? '生成失败'; return }
    emit('generated', data.persona)
    emit('update:open', false)
  } catch (e: any) {
    errMsg.value = e.message ?? '请求失败'
  } finally {
    generating.value = false
    stopTips()
  }
}
</script>

<template>
  <Teleport to="body">
    <!-- 遮罩 -->
    <Transition name="mask">
      <div v-if="open" class="fixed inset-0 z-[200]"
        style="background:rgba(29,33,41,.45);backdrop-filter:blur(3px);"
        @click="!generating && emit('update:open', false)" />
    </Transition>

    <!-- 弹窗：手机底部弹出，桌面居中 -->
    <Transition name="slide-up">
      <div v-if="open"
        class="fixed z-[201] bg-white flex flex-col
               left-0 right-0 bottom-0 rounded-t-[18px]
               sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:right-auto
               sm:-translate-x-1/2 sm:-translate-y-1/2
               sm:rounded-[14px]"
        style="width:100%;max-width:680px;max-height:92dvh;
               box-shadow:0 -4px 32px rgba(0,0,0,.12),0 24px 64px rgba(0,0,0,.18);"
        @click.stop>

        <!-- 手机拖动条 -->
        <div class="sm:hidden flex justify-center pt-3 pb-0.5 shrink-0">
          <div class="w-10 h-1 rounded-full bg-[#E5E6EB]" />
        </div>

        <!-- Header -->
        <div class="px-5 sm:px-6 pt-4 pb-3 sm:pt-6 sm:pb-4 border-b border-[#F2F3F5] shrink-0">
          <div class="flex items-center gap-2.5 mb-1">
            <Sparkles :size="18" style="color:#7B61FF" />
            <h2 class="text-[16px] font-semibold" style="color:#1D2129">AI 生成人设</h2>
          </div>
          <p class="text-[12px] text-[#86909C]">粘贴聊天记录，AI 自动分析说话风格并生成人设</p>
        </div>

        <!-- Body（可滚动） -->
        <div class="flex-1 overflow-auto overscroll-contain px-5 sm:px-6 py-4 space-y-4 min-h-0">

          <!-- 前置提示词 -->
          <div>
            <label class="block text-[12px] text-[#86909C] mb-1.5">前置提示词（可选）</label>
            <div class="relative">
              <select v-model="selectedTplId"
                class="form-input appearance-none pr-9 text-[13px]"
                :disabled="tplLoading || generating">
                <option value="none">不使用前置提示词</option>
                <option v-for="t in templates" :key="t.id" :value="t.id">{{ t.name }}</option>
              </select>
              <ChevronDown :size="14"
                class="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-[#86909C]" />
            </div>
            <div v-if="selectedTplId !== 'none' && templates.find(t => t.id === selectedTplId)"
              class="mt-2 px-3 py-2 rounded-[8px] text-[11px] text-[#86909C] leading-relaxed"
              style="background:#F7F9FF;border:1px solid #C2D4FF;">
              {{ templates.find(t => t.id === selectedTplId)?.content.slice(0, 150) }}{{ (templates.find(t => t.id === selectedTplId)?.content.length ?? 0) > 150 ? '…' : '' }}
            </div>
          </div>

          <!-- 聊天记录 -->
          <div>
            <div class="flex items-center justify-between mb-1.5">
              <label class="text-[12px] text-[#86909C]">聊天记录</label>
              <span class="text-[11px] text-[#C9CDD4]">{{ chatContent.length }} 字符</span>
            </div>
            <textarea
              v-model="chatContent"
              :disabled="generating"
              class="form-input"
              style="min-height:160px;resize:none;line-height:1.7;"
              placeholder="把聊天记录粘贴到这里...

支持微信聊天导出格式，例如：
张三：哈哈哈好的好的，你说的对
李四：那就这样吧，明天见" />
          </div>

          <!-- 错误提示 -->
          <div v-if="errMsg"
            class="px-3 py-2.5 rounded-[8px] text-[13px]"
            style="background:rgba(245,63,63,.08);border:1px solid rgba(245,63,63,.25);color:#F53F3F">
            {{ errMsg }}
          </div>
        </div>

        <!-- Footer -->
        <div class="px-5 sm:px-6 py-3 sm:py-4 border-t border-[#F2F3F5] bg-[#FAFBFC] flex items-center justify-end gap-2 shrink-0"
          :class="{ 'safe-bottom': true }">
          <button class="btn btn-ghost" :disabled="generating" @click="emit('update:open', false)">取消</button>
          <button class="btn btn-ai" :disabled="generating" @click="generate">
            <Sparkles :size="14" />
            {{ generating ? 'AI 生成中...' : '生成人设' }}
          </button>
        </div>

        <!-- ===== 加载覆盖层 ===== -->
        <Transition name="loading-fade">
          <div v-if="generating"
            class="absolute inset-0 flex flex-col items-center justify-center rounded-[inherit] z-10"
            style="background:rgba(255,255,255,.92);backdrop-filter:blur(4px);">

            <!-- 转圈动画 -->
            <div class="spinner mb-4" />

            <!-- AI 图标 -->
            <div class="w-12 h-12 rounded-full flex items-center justify-center mb-3"
              style="background:linear-gradient(135deg,#7B61FF,#4080FF)">
              <Sparkles :size="22" style="color:#fff" />
            </div>

            <div class="text-[15px] font-medium" style="color:#1D2129">AI 正在工作中</div>
            <div class="text-[13px] text-[#86909C] mt-1.5 min-h-[20px] transition-all">
              {{ loadingTip }}
            </div>
            <div class="text-[11px] text-[#C9CDD4] mt-3">这通常需要 10 ~ 30 秒，请耐心等待</div>
          </div>
        </Transition>

      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.form-input {
  width:100%; padding:10px 12px; height:auto;
  background:#fff; color:#1D2129;
  border:1px solid #E5E6EB; border-radius:8px;
  font-size:14px; outline:none; font-family:inherit;
  transition: border-color .15s, box-shadow .15s;
}
.form-input:focus { border-color:#7B61FF; box-shadow: 0 0 0 3px rgba(123,97,255,.15); }
.form-input:disabled { background:#F7F8FA; cursor:not-allowed; }

.btn {
  height:40px; padding:0 20px; border-radius:10px;
  font-size:14px; cursor:pointer; border:none;
  display:inline-flex; align-items:center; gap:6px;
  transition: all .15s; white-space:nowrap;
}
.btn:disabled { opacity:.6; cursor:not-allowed; }
.btn-ghost   { background:transparent; color:#4E5969; }
.btn-ghost:hover:not(:disabled) { background:#F2F3F5; }
.btn-ai {
  background: linear-gradient(135deg, #7B61FF 0%, #4080FF 100%);
  color:#fff; flex:1;
  box-shadow: 0 4px 14px rgba(123,97,255,.3);
}
.btn-ai:hover:not(:disabled) { opacity:.9; }

/* 转圈 spinner */
.spinner {
  position:absolute;
  top:24px; left:50%; transform:translateX(-50%);
  width:48px; height:48px;
  border:3px solid rgba(123,97,255,.15);
  border-top-color:#7B61FF;
  border-radius:50%;
  animation: spin .8s linear infinite;
}
@keyframes spin { to { transform:translateX(-50%) rotate(360deg); } }

/* 遮罩动画 */
.mask-enter-active,.mask-leave-active { transition:opacity .2s ease; }
.mask-enter-from,.mask-leave-to { opacity:0; }

/* 弹窗动画：手机从底部滑入，桌面缩放 */
.slide-up-enter-active,.slide-up-leave-active { transition:all .3s cubic-bezier(.16,1,.3,1); }
@media (max-width:639px) {
  .slide-up-enter-from,.slide-up-leave-to { transform:translateY(100%); opacity:0; }
}
@media (min-width:640px) {
  .slide-up-enter-from,.slide-up-leave-to { opacity:0; transform:translate(-50%,-48%) scale(.97); }
}

/* 加载层渐入 */
.loading-fade-enter-active,.loading-fade-leave-active { transition:opacity .25s ease; }
.loading-fade-enter-from,.loading-fade-leave-to { opacity:0; }
</style>
