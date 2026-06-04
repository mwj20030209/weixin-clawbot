<script setup lang="ts">
import { ref, watch } from 'vue'
import { MessageSquare, Clock, Zap, Save } from 'lucide-vue-next'
import ChatHistory from './ChatHistory.vue'
import MiniLineChart from './MiniLineChart.vue'
import type { Bot } from './BotCard.vue'

const props = defineProps<{ open: boolean; bot: Bot | null; token?: string }>()
const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'save', payload: { id: string; persona: string }): void
}>()

const tab = ref<'persona' | 'stats' | 'chats'>('persona')
const persona = ref('')

watch(() => props.bot?.id, () => {
  if (props.bot) persona.value = props.bot.persona
  tab.value = 'persona'
})

const chartData = [
  { d: 'Mon', v: 24 }, { d: 'Tue', v: 38 }, { d: 'Wed', v: 31 },
  { d: 'Thu', v: 52 }, { d: 'Fri', v: 47 }, { d: 'Sat', v: 63 }, { d: 'Sun', v: 58 },
]
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer-mask">
      <div
        v-if="open"
        class="fixed inset-0 z-[180]"
        style="background: rgba(29,33,41,.35); backdrop-filter: blur(2px);"
        @click="emit('update:open', false)"
      />
    </Transition>

    <Transition name="drawer">
      <aside
        v-if="open && bot"
        class="drawer fixed top-0 right-0 bottom-0 z-[181] bg-white flex flex-col"
        :style="{ width: '100%', maxWidth: '720px', borderLeft: '1px solid #F2F3F5' }"
      >
        <!-- header -->
        <div class="px-4 sm:px-6 py-4 sm:py-5 border-b border-[#F2F3F5] flex items-center gap-3">
          <div class="w-9 h-9 sm:w-11 sm:h-11 rounded-[10px] bg-[#F7F8FA] flex items-center justify-center shrink-0" style="font-size:20px">
            {{ bot.emoji }}
          </div>
          <div class="flex-1 min-w-0">
            <div style="color:#1D2129" class="truncate">{{ bot.name }}</div>
            <div class="text-[12px] text-[#86909C] mt-0.5">ID: {{ bot.id }}</div>
          </div>
          <button class="close-btn" @click="emit('update:open', false)">✕</button>
        </div>

        <!-- tabs -->
        <div class="px-4 sm:px-6 mt-3 sm:mt-4">
          <div class="flex bg-[#F7F8FA] rounded-[10px] p-1">
            <button
              v-for="t in [
                { k: 'persona', l: '人设配置' },
                { k: 'stats',   l: '数据统计' },
                { k: 'chats',   l: '聊天记录' },
              ]"
              :key="t.k"
              class="tab-btn flex-1"
              :class="{ active: tab === t.k }"
              @click="tab = t.k as any"
            >{{ t.l }}</button>
          </div>
        </div>

        <!-- persona -->
        <div v-show="tab === 'persona'" class="flex-1 overflow-auto px-4 sm:px-6 py-4 sm:py-5 space-y-4 sm:space-y-5">
          <div class="rounded-[12px] border border-[#F2F3F5] bg-[#FAFBFC] p-4 grid grid-cols-2 gap-4">
            <div><div class="cell-label">状态</div><div class="cell-value">{{ bot.status }}</div></div>
            <div><div class="cell-label">在线时长</div><div class="cell-value">{{ bot.onlineTime }}</div></div>
            <div><div class="cell-label">创建时间</div><div class="cell-value">2026-05-28</div></div>
            <div><div class="cell-label">最近活跃</div><div class="cell-value">2 分钟前</div></div>
          </div>

          <div>
            <div class="flex items-center justify-between mb-2">
              <label class="text-[13px] text-[#4E5969]">系统人设 Prompt</label>
              <span class="text-[12px] text-[#86909C]">{{ persona.length }} 字符</span>
            </div>
            <textarea v-model="persona" class="form-input" style="min-height:280px; resize:none; line-height:1.6;" />
          </div>

          <button class="btn-primary-full" @click="emit('save', { id: bot.id, persona })">
            <Save :size="15" /> 保存修改
          </button>
        </div>

        <!-- stats -->
        <div v-show="tab === 'stats'" class="flex-1 overflow-auto px-4 sm:px-6 py-4 sm:py-5 space-y-4 sm:space-y-5">
          <div class="rounded-[12px] border border-[#F2F3F5] p-4">
            <div class="flex items-center justify-between mb-2">
              <span class="text-[13px] text-[#4E5969]">剩余在线时长</span>
              <span class="text-[13px]" style="color:#4080FF">18h 24m / 24h</span>
            </div>
            <div class="progress"><div class="progress-bar" style="width:76%" /></div>
            <div class="text-[12px] text-[#86909C] mt-2">登录于 2026-06-03 09:12</div>
          </div>

          <div class="grid grid-cols-3 gap-3">
            <div class="mini-stat">
              <div class="mini-head"><MessageSquare :size="13" /><span>今日对话</span></div>
              <div class="mini-val">312</div>
            </div>
            <div class="mini-stat">
              <div class="mini-head"><Clock :size="13" /><span>平均响应</span></div>
              <div class="mini-val">1.2s</div>
            </div>
            <div class="mini-stat">
              <div class="mini-head"><Zap :size="13" /><span>累计消息</span></div>
              <div class="mini-val">8.4k</div>
            </div>
          </div>

          <div class="rounded-[12px] border border-[#F2F3F5] p-4">
            <div class="flex items-center justify-between mb-3">
              <span class="text-[13px]" style="color:#1D2129">近 7 天对话趋势</span>
              <span class="text-[12px] text-[#86909C]">单位：次</span>
            </div>
            <MiniLineChart :data="chartData" />
          </div>
        </div>

        <!-- chats -->
        <div v-show="tab === 'chats'" class="flex-1 overflow-hidden">
          <ChatHistory :bot-id="bot.id" :token="props.token" />
        </div>
      </aside>
    </Transition>
  </Teleport>
</template>

<style scoped>
.close-btn {
  width:32px; height:32px; border-radius:8px;
  background:transparent; border:none; cursor:pointer;
  color:#86909C; font-size:16px; transition: all .15s;
}
.close-btn:hover { background:#F2F3F5; color:#1D2129; }

.tab-btn {
  padding:6px 16px; border-radius:8px;
  font-size:13px; color:#4E5969;
  background:transparent; border:none; cursor:pointer;
  transition: all .15s;
}
.tab-btn.active {
  background:#fff; color:#4080FF;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
}

.cell-label { font-size:12px; color:#86909C; margin-bottom:4px; }
.cell-value { font-size:13px; color:#1D2129; }

.form-input {
  width:100%; padding:10px 12px;
  background:#fff; color:#1D2129;
  border:1px solid #E5E6EB; border-radius:8px;
  font-size:14px; outline:none;
  transition: border-color .15s, box-shadow .15s;
}
.form-input:focus { border-color:#4080FF; box-shadow: 0 0 0 3px rgba(64,128,255,.15); }

.btn-primary-full {
  width:100%; height:40px; border-radius:8px;
  background:#4080FF; color:#fff; border:none; cursor:pointer;
  display:inline-flex; align-items:center; justify-content:center; gap:6px;
  font-size:14px; transition: background .15s;
}
.btn-primary-full:hover { background:#2D6FED; }

.progress { width:100%; height:8px; background:#F2F3F5; border-radius:999px; overflow:hidden; }
.progress-bar { height:100%; background:#4080FF; border-radius:999px; transition: width .4s ease; }

.mini-stat { border:1px solid #F2F3F5; border-radius:12px; padding:12px; }
.mini-head { display:flex; align-items:center; gap:6px; color:#86909C; font-size:12px; margin-bottom:6px; }
.mini-val  { color:#1D2129; font-variant-numeric: tabular-nums; }

/* transitions */
.drawer-mask-enter-active, .drawer-mask-leave-active { transition: opacity .25s ease; }
.drawer-mask-enter-from,   .drawer-mask-leave-to    { opacity: 0; }

.drawer-enter-active, .drawer-leave-active { transition: transform .3s cubic-bezier(.16,1,.3,1); }
.drawer-enter-from,   .drawer-leave-to    { transform: translateX(100%); }
</style>
