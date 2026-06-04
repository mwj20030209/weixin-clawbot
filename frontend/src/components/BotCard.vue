<script setup lang="ts">
import { computed } from 'vue'
import { RotateCw, Trash2, Eye } from 'lucide-vue-next'

export type BotStatus = 'active' | 'scanning' | 'reconnecting' | 'expired' | 'stopped'
export interface Bot {
  id: string
  name: string
  emoji: string
  status: BotStatus
  persona: string
  onlineTime: string
  qrcodeUrl?: string | null
}

const props = defineProps<{ bot: Bot }>()
defineEmits<{
  (e: 'view',    bot: Bot): void
  (e: 'restart', bot: Bot): void
  (e: 'delete',  bot: Bot): void
}>()

const statusMap: Record<BotStatus, { label: string; color: string; bg: string; pulse?: boolean }> = {
  active:       { label: '运行中',   color: '#4080FF', bg: 'rgba(64,128,255,0.10)' },
  scanning:     { label: '等待扫码', color: '#FF7D00', bg: 'rgba(255,125,0,0.12)', pulse: true },
  reconnecting: { label: '重连中',   color: '#FF7D00', bg: 'rgba(255,125,0,0.08)', pulse: true },
  expired:      { label: '已过期',   color: '#F53F3F', bg: 'rgba(245,63,63,0.10)' },
  stopped:      { label: '已停止',   color: '#86909C', bg: 'rgba(134,144,156,0.12)' },
}
const s = computed(() => statusMap[props.bot.status])
</script>

<template>
  <div
    class="bot-card bg-white rounded-[12px] border border-[#F2F3F5] overflow-hidden group transition-transform hover:-translate-y-1"
    :style="{ boxShadow: '0 1px 2px rgba(0,0,0,0.02), 0 4px 12px rgba(20,30,55,0.04)' }"
  >
    <div class="p-5">
      <div class="flex items-start gap-3">
        <div class="w-11 h-11 rounded-[10px] bg-[#F7F8FA] flex items-center justify-center shrink-0" style="font-size:24px">
          {{ bot.emoji }}
        </div>
        <div class="flex-1 min-w-0">
          <div class="truncate" style="color:#1D2129">{{ bot.name }}</div>
          <div class="text-[12px] text-[#86909C] mt-0.5">在线 {{ bot.onlineTime }}</div>
        </div>
        <div
          class="px-2.5 py-1 rounded-full text-[12px] flex items-center gap-1.5 shrink-0"
          :class="{ 'pulse-soft': s.pulse }"
          :style="{ background: s.bg, color: s.color }"
        >
          <span class="w-1.5 h-1.5 rounded-full" :style="{ background: s.color }" />
          {{ s.label }}
        </div>
      </div>

      <p class="mt-4 text-[13px] leading-relaxed text-[#4E5969] line-clamp-2 min-h-[40px]">
        {{ bot.persona }}
      </p>
    </div>

    <div class="px-3 pb-3 pt-1 flex items-center gap-2 border-t border-[#F7F8FA]">
      <button class="card-btn" @click="$emit('view',    bot)"><Eye     :size="15" /> 详情</button>
      <button class="card-btn" @click="$emit('restart', bot)"><RotateCw :size="15" /> 重启</button>
      <button class="card-btn danger" @click="$emit('delete',  bot)"><Trash2 :size="15" /> 删除</button>
    </div>
  </div>
</template>

<style scoped>
.bot-card { animation: fadeUp .4s cubic-bezier(.16,1,.3,1) both; }
@keyframes fadeUp {
  from { opacity:0; transform: translateY(16px); }
  to   { opacity:1; transform: translateY(0); }
}

.card-btn {
  flex:1; display:flex; align-items:center; justify-content:center; gap:6px;
  height:36px; border-radius:8px; font-size:13px;
  color:#4E5969; background:transparent; border:none; cursor:pointer;
  transition: all .15s;
}
.card-btn:hover { background:#F7F8FA; color:#4080FF; }
.card-btn.danger:hover { background:#FFECE8; color:#F53F3F; }

.pulse-soft { animation: pulseSoft 1.4s ease-in-out infinite; }
@keyframes pulseSoft {
  0%,100% { opacity:1; }
  50%     { opacity:.55; }
}
</style>
