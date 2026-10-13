import { reactive } from 'vue'

// 目前執行中的版本（建置時寫入）；伺服器上的最新版本在 version.json
export const APP_VERSION = __APP_VERSION__

export const update = reactive({ latest: '', hasUpdate: false, checking: false })

let lastCheck = 0
const MIN_GAP = 5 * 60 * 1000

// 回傳 true／false 表示有無新版；連不上時丟出錯誤
export async function checkUpdate() {
  update.checking = true
  try {
    const res = await fetch('./version.json?t=' + Date.now(), { cache: 'no-store' })
    if (!res.ok) throw new Error(res.status)
    const { version } = await res.json()
    update.latest = version
    update.hasUpdate = version !== APP_VERSION
    lastCheck = Date.now()
    return update.hasUpdate
  } finally {
    update.checking = false
  }
}

// App 從背景回來時自動檢查（至少間隔 5 分鐘），失敗就安靜略過
export function watchForUpdates() {
  if (!import.meta.env.PROD) return
  const auto = () => { if (Date.now() - lastCheck > MIN_GAP) checkUpdate().catch(() => {}) }
  auto()
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') auto() })
}

// 換一個網址重新載入，繞過 index.html 的 HTTP 快取；JS／CSS 檔名帶 hash，會一併拿到新版
export async function applyUpdate() {
  try { await (await navigator.serviceWorker?.getRegistration())?.update() } catch { /* 略過 */ }
  location.replace('./?v=' + encodeURIComponent(update.latest || Date.now()) + location.hash)
}
