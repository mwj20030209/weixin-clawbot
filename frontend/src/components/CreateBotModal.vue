<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { Sparkles } from 'lucide-vue-next'
import { apiUrl } from '../lib/api'
import BaseModal from './BaseModal.vue'
import ImportChatModal from './ImportChatModal.vue'

type Persona = { id: number; name: string; content: string; is_default: number }

const props = defineProps<{ open: boolean; token?: string }>()
const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'create', data: { name: string; persona: string; personaId: number | null; gender: string }): void
}>()

const name       = ref('')
const gender     = ref<'male' | 'female' | ''>('')
const persona    = ref('')
const personaId  = ref<number | null>(null)
const touched    = ref(false)
const personas   = ref<Persona[]>([])
const showImport = ref(false)

async function loadPersonas() {
  try {
    const list: Persona[] = await fetch(apiUrl('/api/personas')).then(r => r.json())
    personas.value = list
    const def = list.find(p => p.is_default)
    if (def) personaId.value = def.id
  } catch {}
}

onMounted(loadPersonas)
watch(() => props.open, (v) => {
  if (v) {
    loadPersonas()
  } else {
    // 关闭时重置
    name.value      = ''
    gender.value    = ''
    persona.value   = ''
    personaId.value = null
    touched.value   = false
  }
})

function onGenerated(text: string) {
  persona.value = text
}

function submit() {
  touched.value = true
  if (!name.value.trim()) return
  if (!gender.value) return
  emit('create', {
    name:      name.value.trim(),
    gender:    gender.value,
    persona:   persona.value.trim(),
    personaId: personaId.value,
  })
}
</script>

<template>
  <BaseModal :open="open" width="480px" @update:open="emit('update:open', $event)">
    <div class="px-5 sm:px-6 pt-5 sm:pt-6 pb-2">
      <h2 class="text-[16px]" style="color:#1D2129">新建机器人</h2>
    </div>

    <div class="px-5 sm:px-6 py-4 space-y-4">
      <!-- Bot 名称 -->
      <div>
        <label class="block text-[13px] mb-2 text-[#4E5969]">
          Bot 名称 <span style="color:#F53F3F">*</span>
        </label>
        <input v-model="name" class="form-input" placeholder="例如：客服小助手" />
        <div v-if="touched && !name.trim()" class="text-[12px] mt-1.5" style="color:#F53F3F">
          请输入 Bot 名称
        </div>
      </div>

      <!-- 性别（必选） -->
      <div>
        <label class="block text-[13px] mb-2 text-[#4E5969]">
          模拟性别 <span style="color:#F53F3F">*</span>
          <span class="text-[11px] text-[#86909C] ml-1 font-normal">决定 AI 的说话风格与语气</span>
        </label>
        <div class="flex gap-3">
          <button
            type="button"
            class="gender-btn"
            :class="{ selected: gender === 'male' }"
            @click="gender = 'male'">
            <span class="text-2xl">👨</span>
            <span class="text-[13px] font-medium mt-1">男性</span>
            <span class="text-[11px] text-[#86909C]">阳刚 · 直接</span>
          </button>
          <button
            type="button"
            class="gender-btn"
            :class="{ selected: gender === 'female' }"
            @click="gender = 'female'">
            <span class="text-2xl">👩</span>
            <span class="text-[13px] font-medium mt-1">女性</span>
            <span class="text-[11px] text-[#86909C]">温柔 · 细腻</span>
          </button>
        </div>
        <div v-if="touched && !gender" class="text-[12px] mt-1.5" style="color:#F53F3F">
          请选择性别
        </div>
      </div>

      <!-- AI 人设模板 -->
      <div>
        <label class="block text-[13px] mb-2 text-[#4E5969]">AI 人设模板</label>
        <select v-model="personaId" class="form-input">
          <option :value="null">不使用模板（使用全局默认）</option>
          <option v-for="p in personas" :key="p.id" :value="p.id">
            {{ p.name }}{{ p.is_default ? ' （默认）' : '' }}
          </option>
        </select>
        <div v-if="personaId && personas.find(p => p.id === personaId)"
          class="mt-2 p-3 rounded-[8px] text-[11px] leading-relaxed text-[#86909C]"
          style="background:#F7F8FA;border:1px solid #E5E6EB;max-height:80px;overflow:hidden;">
          {{ personas.find(p => p.id === personaId)?.content.slice(0, 120) }}...
        </div>
      </div>

      <!-- 自定义补充 -->
      <div>
        <div class="flex items-center justify-between mb-2">
          <label class="text-[13px] text-[#4E5969]">自定义补充（选填）</label>
          <button
            type="button"
            class="flex items-center gap-1.5 text-[12px] px-3 py-1 rounded-[6px]"
            style="background:linear-gradient(135deg,#7B61FF,#4080FF);color:#fff;border:none;cursor:pointer;"
            @click="showImport = true">
            <Sparkles :size="13" />
            导入聊天生成
          </button>
        </div>
        <textarea
          v-model="persona"
          class="form-input"
          style="min-height:100px; resize:none; line-height:1.6;"
          placeholder="在模板基础上追加本 Bot 独有的设定，或直接点击「导入聊天生成」从聊天记录自动生成人设"
        />
        <!-- 基础人设说明 -->
        <div class="mt-2 rounded-[8px] p-3" style="background:#F7F8FA; border:1px solid #E5E6EB;">
          <div class="flex items-center gap-1.5 mb-1">
            <span style="font-size:12px;">🛡️</span>
            <span class="text-[12px] font-medium" style="color:#4E5969;">已内置基础规范（始终生效）</span>
          </div>
          <div class="text-[11px] text-[#86909C]">
            ✓ 仅中文·✓ 禁 Markdown·✓ 简洁回复·✓ 不讨论敏感违法内容
          </div>
          <div class="text-[11px] text-[#C9CDD4] mt-0.5">最终 Prompt = 基础规范 + 性别设定 + 模板内容 + 自定义补充</div>
        </div>
      </div>
    </div>

    <div class="px-5 sm:px-6 py-3 sm:py-4 bg-[#FAFBFC] border-t border-[#F2F3F5] flex justify-end gap-2 safe-bottom">
      <button class="btn btn-ghost" @click="emit('update:open', false)">取消</button>
      <button class="btn btn-primary flex-1 sm:flex-none" @click="submit">创建</button>
    </div>
  </BaseModal>

  <!-- 导入聊天生成人设弹窗 -->
  <ImportChatModal
    v-model:open="showImport"
    :token="props.token ?? ''"
    @generated="onGenerated"
  />
</template>

<style scoped>
.form-input {
  width:100%; padding:10px 12px; height:auto;
  background:#fff; color:#1D2129;
  border:1px solid #E5E6EB; border-radius:8px;
  font-size:14px; outline:none;
  transition: border-color .15s, box-shadow .15s;
}
.form-input:focus { border-color:#4080FF; box-shadow: 0 0 0 3px rgba(64,128,255,0.15); }

.gender-btn {
  flex:1; display:flex; flex-direction:column; align-items:center; gap:2px;
  padding:12px 8px; border:1.5px solid #E5E6EB; border-radius:10px;
  background:#fff; cursor:pointer; transition:all .15s;
}
.gender-btn:hover:not(.selected) { border-color:#C2D4FF; background:#F7F9FF; }
.gender-btn.selected { border-color:#4080FF; background:rgba(64,128,255,.06); }

.btn {
  height:40px; padding:0 20px; border-radius:10px;
  font-size:14px; cursor:pointer; border:none;
  display:inline-flex; align-items:center; justify-content:center;
  transition: all .15s;
}
.btn-ghost   { background:transparent; color:#4E5969; }
.btn-ghost:hover { background:#F2F3F5; }
.btn-primary { background:#4080FF; color:#fff; }
.btn-primary:hover { background:#2D6FED; }
</style>
