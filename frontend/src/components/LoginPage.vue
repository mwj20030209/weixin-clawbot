<script setup lang="ts">
import { ref } from 'vue'
import { Bot } from 'lucide-vue-next'
import { apiUrl } from '../lib/api'

const emit = defineEmits<{
  (e: 'login', data: { token: string; username: string; role: string; quota: number; inviteCode: string }): void
}>()

const mode       = ref<'login' | 'register'>('login')
const username   = ref('')
const password   = ref('')
const inviteCode = ref('')
const loading    = ref(false)
const errMsg     = ref('')
const successMsg = ref('')

function switchMode(m: 'login' | 'register') {
  mode.value = m
  errMsg.value = ''
  successMsg.value = ''
  username.value = ''
  password.value = ''
  inviteCode.value = ''
}

async function submitLogin() {
  if (!username.value.trim() || !password.value.trim()) {
    errMsg.value = '请输入账号和密码'
    return
  }
  loading.value = true
  errMsg.value  = ''
  try {
    const res  = await fetch(apiUrl('/api/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.value.trim(), password: password.value.trim() }),
    })
    const data = await res.json()
    if (!res.ok) { errMsg.value = data.error ?? '登录失败'; return }
    emit('login', { token: data.token, username: data.username, role: data.role, quota: data.quota ?? 0, inviteCode: data.inviteCode ?? '' })
  } catch { errMsg.value = '网络错误，请重试' }
  finally { loading.value = false }
}

async function submitRegister() {
  if (!username.value.trim()) { errMsg.value = '请输入账号'; return }
  if (!password.value.trim()) { errMsg.value = '请输入密码'; return }
  if (password.value.trim().length < 6) { errMsg.value = '密码不能少于6位'; return }
  loading.value = true
  errMsg.value  = ''
  try {
    const res  = await fetch(apiUrl('/api/auth/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: username.value.trim(),
        password: password.value.trim(),
        inviteCode: inviteCode.value.trim() || undefined,
      }),
    })
    const data = await res.json()
    if (!res.ok) { errMsg.value = data.error ?? '注册失败'; return }
    successMsg.value = '注册成功！请登录'
    setTimeout(() => switchMode('login'), 1500)
  } catch { errMsg.value = '网络错误，请重试' }
  finally { loading.value = false }
}
</script>

<template>
  <div class="min-h-screen w-full flex items-center justify-center bg-[#F7F8FA]"
    style='font-family:"Microsoft YaHei","PingFang SC",-apple-system,sans-serif;'>

    <div class="login-card">
      <!-- Logo -->
      <div class="flex flex-col items-center mb-6">
        <div class="w-14 h-14 rounded-[16px] flex items-center justify-center text-white mb-4"
          style="background:linear-gradient(135deg,#4080FF,#5B8DEF);box-shadow:0 8px 24px rgba(64,128,255,.3)">
          <Bot :size="28" />
        </div>
        <h1 class="text-[22px] font-semibold" style="color:#1D2129">微信 ClawBot</h1>
        <p class="text-[13px] text-[#86909C] mt-1">多 Bot 管理面板</p>
      </div>

      <!-- Tab 切换 -->
      <div class="flex mb-6 bg-[#F7F8FA] rounded-[10px] p-1">
        <button class="tab-btn" :class="{ active: mode === 'login' }" @click="switchMode('login')">登录</button>
        <button class="tab-btn" :class="{ active: mode === 'register' }" @click="switchMode('register')">注册</button>
      </div>

      <!-- 登录表单 -->
      <div v-if="mode === 'login'" class="space-y-4">
        <div>
          <label class="block text-[13px] text-[#4E5969] mb-1.5">账号</label>
          <input v-model="username" type="text" class="login-input" placeholder="请输入账号" @keyup.enter="submitLogin" />
        </div>
        <div>
          <label class="block text-[13px] text-[#4E5969] mb-1.5">密码</label>
          <input v-model="password" type="password" class="login-input" placeholder="请输入密码" @keyup.enter="submitLogin" />
        </div>
        <div v-if="errMsg" class="err-box">{{ errMsg }}</div>
        <button class="login-btn" :disabled="loading" @click="submitLogin">
          {{ loading ? '登录中...' : '登 录' }}
        </button>
      </div>

      <!-- 注册表单 -->
      <div v-else class="space-y-4">
        <div>
          <label class="block text-[13px] text-[#4E5969] mb-1.5">账号</label>
          <input v-model="username" type="text" class="login-input" placeholder="设置登录账号" @keyup.enter="submitRegister" />
        </div>
        <div>
          <label class="block text-[13px] text-[#4E5969] mb-1.5">密码 <span class="text-[#86909C]">（至少6位）</span></label>
          <input v-model="password" type="password" class="login-input" placeholder="设置登录密码" @keyup.enter="submitRegister" />
        </div>
        <div>
          <label class="block text-[13px] text-[#4E5969] mb-1.5">邀请码 <span class="text-[#86909C]">（选填）</span></label>
          <input v-model="inviteCode" type="text" class="login-input" placeholder="填写邀请码可获额外额度" @keyup.enter="submitRegister" />
        </div>
        <div v-if="errMsg" class="err-box">{{ errMsg }}</div>
        <div v-if="successMsg" class="suc-box">{{ successMsg }}</div>
        <button class="login-btn" :disabled="loading" @click="submitRegister">
          {{ loading ? '注册中...' : '立即注册' }}
        </button>
      </div>

      <p class="text-center text-[12px] text-[#C9CDD4] mt-6">联系微信：li797336782</p>
    </div>
  </div>  
</template>

<style scoped>
.login-card {
  width: 100%;
  max-width: 380px;
  background: #fff;
  border-radius: 16px;
  padding: 40px 36px 32px;
  box-shadow: 0 4px 32px rgba(0,0,0,.08);
}

.tab-btn {
  flex: 1; height: 36px; border-radius: 8px; background: transparent; border: none;
  font-size: 14px; color: #86909C; cursor: pointer; transition: all .15s;
}
.tab-btn.active { background: #fff; color: #4080FF; font-weight: 500; box-shadow: 0 1px 4px rgba(0,0,0,.08); }

.login-input {
  width: 100%;
  height: 44px;
  padding: 0 14px;
  background: #F7F8FA;
  border: 1px solid #E5E6EB;
  border-radius: 10px;
  font-size: 14px;
  color: #1D2129;
  outline: none;
  transition: border-color .15s, box-shadow .15s, background .15s;
}
.login-input:focus {
  background: #fff;
  border-color: #4080FF;
  box-shadow: 0 0 0 3px rgba(64,128,255,.15);
}

.err-box {
  padding: 10px 14px;
  background: rgba(245,63,63,.08);
  border: 1px solid rgba(245,63,63,.25);
  border-radius: 8px;
  color: #F53F3F;
  font-size: 13px;
}
.suc-box {
  padding: 10px 14px;
  background: rgba(0,180,42,.08);
  border: 1px solid rgba(0,180,42,.25);
  border-radius: 8px;
  color: #00B42A;
  font-size: 13px;
}

.login-btn {
  width: 100%;
  height: 44px;
  background: #4080FF;
  color: #fff;
  border: none;
  border-radius: 10px;
  font-size: 15px;
  cursor: pointer;
  transition: background .15s, transform .1s;
  box-shadow: 0 4px 16px rgba(64,128,255,.3);
  margin-top: 4px;
}
.login-btn:hover:not(:disabled) { background: #2D6FED; }
.login-btn:active:not(:disabled) { transform: translateY(1px); }
.login-btn:disabled { opacity: .6; cursor: not-allowed; }
</style>
