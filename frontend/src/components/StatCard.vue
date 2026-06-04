<script setup lang="ts">
import { computed } from 'vue'
import { Bot, Activity, QrCode, PowerOff } from 'lucide-vue-next'

const props = defineProps<{
  variant: 'total' | 'active' | 'scanning' | 'stopped'
  value: number
}>()

const config = {
  total:    { label: '机器人总数', icon: Bot,      color: '#4080FF', bg: 'rgba(64,128,255,0.10)' },
  active:   { label: '运行中',     icon: Activity, color: '#4080FF', bg: 'rgba(64,128,255,0.10)' },
  scanning: { label: '待扫码',     icon: QrCode,   color: '#FF7D00', bg: 'rgba(255,125,0,0.10)' },
  stopped:  { label: '已停用',     icon: PowerOff, color: '#86909C', bg: 'rgba(134,144,156,0.12)' },
}

const c = computed(() => config[props.variant])
</script>

<template>
  <div
    class="stat-card bg-white rounded-[12px] p-5 flex items-center gap-4 border border-[#F2F3F5] transition-transform hover:-translate-y-0.5"
    :style="{ boxShadow: '0 1px 2px rgba(0,0,0,0.02), 0 4px 12px rgba(20,30,55,0.04)' }"
  >
    <div
      class="w-12 h-12 rounded-[10px] flex items-center justify-center shrink-0"
      :style="{ background: c.bg }"
    >
      <component :is="c.icon" :size="22" :style="{ color: c.color }" />
    </div>
    <div class="min-w-0">
      <div class="text-[13px] text-[#86909C] mb-1">{{ c.label }}</div>
      <div
        class="text-[24px] leading-none tracking-tight"
        style="color:#1D2129; font-variant-numeric: tabular-nums"
      >
        {{ value }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.stat-card { animation: rise .4s cubic-bezier(.16,1,.3,1) both; }
@keyframes rise {
  from { opacity:0; transform: translateY(12px); }
  to   { opacity:1; transform: translateY(0); }
}
</style>
