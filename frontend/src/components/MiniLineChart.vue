<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  data: { d: string; v: number }[]
  width?: number
  height?: number
}>()

const w = computed(() => props.width ?? 460)
const h = computed(() => props.height ?? 180)
const pad = { l: 28, r: 12, t: 12, b: 22 }

const max = computed(() => Math.max(...props.data.map(d => d.v), 1))
const min = computed(() => Math.min(...props.data.map(d => d.v), 0))

function x(i: number) {
  const n = props.data.length - 1 || 1
  return pad.l + (i / n) * (w.value - pad.l - pad.r)
}
function y(v: number) {
  const range = max.value - min.value || 1
  return pad.t + (1 - (v - min.value) / range) * (h.value - pad.t - pad.b)
}

const path = computed(() =>
  props.data.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.v)}`).join(' ')
)
const area = computed(() =>
  `${path.value} L ${x(props.data.length - 1)} ${h.value - pad.b} L ${x(0)} ${h.value - pad.b} Z`
)
</script>

<template>
  <svg :viewBox="`0 0 ${w} ${h}`" width="100%" :height="h" preserveAspectRatio="none">
    <defs>
      <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="#4080FF" stop-opacity=".3" />
        <stop offset="100%" stop-color="#4080FF" stop-opacity="0" />
      </linearGradient>
    </defs>

    <!-- grid -->
    <line v-for="i in 4" :key="i"
      :x1="pad.l" :x2="w - pad.r"
      :y1="pad.t + ((h - pad.t - pad.b) / 4) * i"
      :y2="pad.t + ((h - pad.t - pad.b) / 4) * i"
      stroke="#F2F3F5" stroke-width="1" />

    <!-- area + line -->
    <path :d="area" fill="url(#chartFill)" />
    <path :d="path" fill="none" stroke="#4080FF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />

    <!-- dots -->
    <g>
      <circle v-for="(p, i) in data" :key="p.d" :cx="x(i)" :cy="y(p.v)" r="3" fill="#4080FF" />
    </g>

    <!-- x labels -->
    <g font-size="11" fill="#C9CDD4">
      <text v-for="(p, i) in data" :key="p.d" :x="x(i)" :y="h - 6" text-anchor="middle">{{ p.d }}</text>
    </g>
  </svg>
</template>
