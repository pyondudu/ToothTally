import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import Overview from './views/Overview.vue'
import RecordForm from './views/RecordForm.vue'
import Records from './views/Records.vue'
import Settings from './views/Settings.vue'
import './style.css'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: Overview },
    { path: '/new', component: RecordForm },
    { path: '/records', component: Records },
    { path: '/records/:id/edit', component: RecordForm, props: true },
    { path: '/settings', component: Settings },
  ],
  scrollBehavior: () => ({ top: 0 }),
})

createApp(App).use(router).mount('#app')

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => {})
}
