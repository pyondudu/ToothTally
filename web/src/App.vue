<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { configured, supabase } from './lib/supabase'
import { store, initAuth } from './lib/store'
import Login from './views/Login.vue'
import ToothBuddy from './components/ToothBuddy.vue'

const router = useRouter()
const ready = ref(false)
const loadErr = ref('')

onMounted(async () => {
  try {
    if (configured) await initAuth()
  } catch (e) {
    loadErr.value = '讀取資料失敗：' + e.message
  }
  ready.value = true
})

// 登出後回到總覽，下一個登入的人不會停在上一個人看的頁面
async function logout() {
  await supabase.auth.signOut()
  router.replace('/')
}
</script>

<template>
  <div v-if="!configured" class="center-box card">
    <h2>尚未設定 Supabase</h2>
    <p>請複製 <code>web/.env.example</code> 為 <code>web/.env</code>，填入 Project URL 與 Publishable key 後重新啟動。</p>
  </div>
  <template v-else-if="ready">
    <Login v-if="!store.session" />
    <template v-else>
      <header class="topbar">
        <router-link to="/" class="brand">
          <ToothBuddy :size="28" />
          <span>ToothTally</span>
        </router-link>
        <div class="topbar-right">
          <span class="role-tag" :class="store.role">{{ store.isAdmin ? '管理者' : (store.myTech?.name ?? '技師') }}</span>
          <button class="btn ghost small" @click="logout">登出</button>
        </div>
      </header>
      <nav class="tabs" aria-label="主要頁面">
        <router-link to="/" class="tab" exact-active-class="on">總覽</router-link>
        <router-link to="/new" class="tab" active-class="on">登記</router-link>
        <router-link to="/records" class="tab" active-class="on">紀錄</router-link>
        <router-link v-if="store.isAdmin" to="/settings" class="tab" active-class="on">設定</router-link>
      </nav>
      <main class="container">
        <p v-if="loadErr" class="msg error">{{ loadErr }}</p>
        <router-view />
      </main>
    </template>
  </template>
</template>
