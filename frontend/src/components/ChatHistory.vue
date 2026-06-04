<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Search, ArrowLeft } from 'lucide-vue-next'
import { apiUrl } from '../lib/api'

type Msg     = { role: 'user' | 'assistant'; content: string; time: string }
type Contact = { userId: string; messages: Msg[] }

const props = defineProps<{ botId: string; token?: string }>()

const contacts  = ref<Contact[]>([])
const activeId  = ref('')
const query     = ref('')
const loading   = ref(false)
const errMsg    = ref('')
const mobileShowThread = ref(false)

async function loadHistory() {
  if (!props.botId) return
  loading.value = true
  errMsg.value  = ''
  try {
    const headers: Record<string, string> = {}
    if (props.token) headers['Authorization'] = `Bearer ${props.token}`
    const res  = await fetch(apiUrl(`/api/bots/${props.botId}/history`), { headers })
    if (!res.ok) { errMsg.value = '加载失败，请关闭后重试'; return }
    const data: Contact[] = await res.json()
    contacts.value = data
    if (data.length && !activeId.value) activeId.value = data[0].userId
  } catch { errMsg.value = '网络错误' }
  loading.value = false
}

watch(() => props.botId, loadHistory, { immediate: true })

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return contacts.value
  return contacts.value.filter(c =>
    c.userId.toLowerCase().includes(q) ||
    c.messages.some(m => m.content.toLowerCase().includes(q))
  )
})

const active  = computed(() => contacts.value.find(c => c.userId === activeId.value))
function lastMsg(c: Contact) { return c.messages[c.messages.length - 1] }
function shortId(uid: string) { return uid.length > 12 ? uid.slice(0, 6) + '…' + uid.slice(-4) : uid }
function pick(id: string) { activeId.value = id; mobileShowThread.value = true }
</script>

<template>
  <div class="chat-root flex h-full border-t border-[#F2F3F5]">
    <!-- list -->
    <div
      class="list-pane flex-col w-full sm:w-[220px] border-r border-[#F2F3F5] bg-[#FAFBFC]"
      :class="mobileShowThread ? 'hidden sm:flex' : 'flex'"
    >
      <div class="p-3 border-b border-[#F2F3F5]">
        <div class="relative">
          <Search :size="14" class="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#86909C]" />
          <input v-model="query" class="search-input" placeholder="搜索用户 / 消息" />
        </div>
      </div>

      <div class="flex-1 overflow-auto py-1">
        <div v-if="loading" class="text-[12px] text-[#86909C] text-center py-8">加载中...</div>
        <div v-else-if="errMsg" class="text-[12px] text-[#F53F3F] text-center py-8 px-3">{{ errMsg }}</div>
        <div v-else-if="filtered.length === 0" class="text-[12px] text-[#86909C] text-center py-8">暂无聊天记录</div>
        <button
          v-for="c in filtered"
          :key="c.userId"
          class="contact-item"
          :class="{ active: c.userId === activeId }"
          @click="pick(c.userId)"
        >
          <div class="avatar">👤</div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between gap-2">
              <span class="truncate text-[13px]" style="color:#1D2129">{{ shortId(c.userId) }}</span>
              <span class="text-[11px] text-[#86909C] shrink-0">{{ lastMsg(c)?.time }}</span>
            </div>
            <div class="flex items-center gap-2 mt-0.5">
              <span class="truncate text-[12px] text-[#86909C]">
                <template v-if="lastMsg(c)?.role === 'assistant'">Bot：</template>{{ lastMsg(c)?.content }}
              </span>
            </div>
          </div>
        </button>
      </div>
    </div>

    <!-- thread -->
    <div
      class="thread-pane flex-1 flex-col bg-white min-w-0"
      :class="mobileShowThread ? 'flex' : 'hidden sm:flex'"
    >
      <template v-if="active">
        <div class="px-4 py-3 border-b border-[#F2F3F5] flex items-center gap-2.5">
          <button class="sm:hidden text-[#4E5969]" @click="mobileShowThread = false" style="background:none;border:none;cursor:pointer;">
            <ArrowLeft :size="18" />
          </button>
          <div class="avatar small">👤</div>
          <div class="min-w-0">
            <div class="text-[13px]" style="color:#1D2129">{{ shortId(active.userId) }}</div>
            <div class="text-[11px] text-[#86909C]">共 {{ active.messages.length }} 条消息</div>
          </div>
        </div>

        <div class="flex-1 overflow-auto px-4 py-4 space-y-3">
          <TransitionGroup name="bubble">
            <div
              v-for="(m, i) in active.messages"
              :key="i"
              class="flex items-end gap-2"
              :class="m.role === 'assistant' ? 'justify-end' : 'justify-start'"
            >
              <div v-if="m.role === 'user'" class="bubble-avatar user">👤</div>
              <div class="bubble" :class="m.role === 'assistant' ? 'bot' : 'user'">
                <div class="whitespace-pre-wrap break-words text-[13px] leading-relaxed">{{ m.content }}</div>
                <div class="meta"><span>{{ m.time }}</span></div>
              </div>
              <div v-if="m.role === 'assistant'" class="bubble-avatar bot">🤖</div>
            </div>
          </TransitionGroup>
        </div>

        <div class="px-4 py-2.5 border-t border-[#F2F3F5] bg-[#FAFBFC] text-center">
          <span class="text-[11px] text-[#86909C]">只读 · 仅展示历史聊天记录</span>
        </div>
      </template>

      <div v-else-if="!loading && contacts.length === 0" class="flex-1 flex items-center justify-center">
        <div class="text-center text-[#86909C]">
          <div class="text-4xl mb-3 opacity-30">💬</div>
          <div class="text-[13px]">暂无聊天记录</div>
          <div class="text-[12px] mt-1">等待用户发送消息后将在此展示</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.search-input {
  width:100%; height:32px; padding:0 8px 0 28px;
  background:#fff; border:1px solid #E5E6EB; border-radius:8px;
  font-size:13px; outline:none; transition: border-color .15s;
}
.search-input:focus { border-color:#4080FF; }

.contact-item {
  width:100%; display:flex; align-items:center; gap:10px;
  padding:10px 12px; text-align:left;
  background:transparent; border:none; cursor:pointer;
  transition: background .15s;
}
.contact-item:hover { background: rgba(255,255,255,.6); }
.contact-item.active { background:#fff; box-shadow: inset 3px 0 0 #4080FF; }

.avatar {
  width:36px; height:36px; border-radius:50%;
  background:#fff; border:1px solid #F2F3F5;
  display:flex; align-items:center; justify-content:center;
  font-size:18px; flex-shrink:0;
}
.avatar.small { width:32px; height:32px; font-size:16px; background:#F7F8FA; border:none; }

.badge {
  min-width:18px; height:18px; padding:0 5px;
  border-radius:9px; background:#F53F3F; color:#fff;
  font-size:11px; display:inline-flex; align-items:center; justify-content:center;
  font-variant-numeric: tabular-nums;
}

.bubble {
  max-width:78%; padding:8px 12px;
}
.bubble.user {
  background:#F2F3F5; color:#1D2129;
  border-radius:12px 12px 12px 4px;
}
.bubble.bot {
  background:#4080FF; color:#fff;
  border-radius:12px 12px 4px 12px;
  box-shadow: 0 4px 10px rgba(64,128,255,.18);
}
.bubble .meta {
  display:flex; align-items:center; gap:4px;
  margin-top:4px; font-size:10px;
}
.bubble.user .meta { color:#86909C; }
.bubble.bot  .meta { color: rgba(255,255,255,.75); }

.bubble-avatar {
  width:28px; height:28px; border-radius:50%;
  display:flex; align-items:center; justify-content:center;
  flex-shrink:0; font-size:14px;
}
.bubble-avatar.user { background:#F7F8FA; }
.bubble-avatar.bot  { background: linear-gradient(135deg,#4080FF,#5B8DEF); color:#fff; font-size:13px; }

.bubble-enter-active { transition: all .22s ease; }
.bubble-enter-from   { opacity:0; transform: translateY(6px); }
</style>
