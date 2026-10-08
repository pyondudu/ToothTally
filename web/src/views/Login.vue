<script setup>
import { ref } from 'vue'
import { supabase } from '../lib/supabase'
import { toLoginEmail } from '../lib/util'
import ToothBuddy from '../components/ToothBuddy.vue'

const email = ref('')
const password = ref('')
const mode = ref('password') // password | magic
const msg = ref('')
const busy = ref(false)

async function submit() {
  msg.value = ''
  busy.value = true
  try {
    if (mode.value === 'password') {
      const { error } = await supabase.auth.signInWithPassword({ email: toLoginEmail(email.value), password: password.value })
      if (error) msg.value = error.message === 'Invalid login credentials' ? '帳號或密碼不正確' : '登入失敗：' + error.message
    } else {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.value,
        options: { shouldCreateUser: false, emailRedirectTo: location.href.split('#')[0] },
      })
      msg.value = error ? '寄送失敗：' + error.message : '已寄出登入連結，請到信箱點擊。'
    }
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="center-box card login">
    <ToothBuddy :size="96" />
    <h1>ToothTally</h1>
    <p class="muted">牙技業績統計</p>
    <form @submit.prevent="submit">
      <label v-if="mode === 'password'" key="account">帳號或 Email<input id="login-account" v-model="email" type="text" required autocomplete="username" autocapitalize="none" spellcheck="false" /></label>
      <label v-else key="email">Email<input id="login-email" v-model="email" type="email" required autocomplete="email" /></label>
      <label v-if="mode === 'password'">密碼<input id="login-password" v-model="password" type="password" required autocomplete="current-password" /></label>
      <button class="btn primary block" :disabled="busy">{{ mode === 'password' ? '登入' : '寄送登入連結' }}</button>
    </form>
    <button class="btn link" @click="mode = mode === 'password' ? 'magic' : 'password'">
      {{ mode === 'password' ? '改用 Email 連結登入（免密碼）' : '改用密碼登入' }}
    </button>
    <p v-if="msg" class="msg">{{ msg }}</p>
  </div>
</template>
