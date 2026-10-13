<script setup>
import { ref } from 'vue'
import { APP_VERSION, update, checkUpdate, applyUpdate } from '../lib/version'

const msg = ref('')
const err = ref('')

async function check() {
  msg.value = ''
  err.value = ''
  try {
    if (!(await checkUpdate())) {
      msg.value = '已是最新版本'
      setTimeout(() => { msg.value = '' }, 2000)
    }
  } catch {
    err.value = '無法檢查更新（請確認網路）'
  }
}
</script>

<template>
  <footer class="app-version small muted">
    <span>版本 {{ APP_VERSION }}</span>
    <template v-if="update.hasUpdate">
      <span>新版本 {{ update.latest }}</span>
      <button class="btn primary small" @click="applyUpdate">立即更新</button>
    </template>
    <button v-else class="btn ghost small" :disabled="update.checking" @click="check">{{ update.checking ? '檢查中…' : '檢查更新' }}</button>
    <span v-if="err" class="msg error">{{ err }}</span>
    <p v-if="msg" class="toast" role="status">{{ msg }}</p>
  </footer>
</template>
