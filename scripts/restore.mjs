// 從 .ttbk 備份還原到 Supabase（只在資料遺失、重建專案時使用）
//
//   npm run restore -- <檔案>                    只解密並印出預計寫入的筆數（不連資料庫）
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run restore -- <檔案> --yes   正式寫入
//
// 對象：已執行過 supabase/schema.sql 的專案（建議是全新專案）。以 id upsert，可重跑。
// service_role key 只放在本機環境變數，不要寫進任何檔案；用完到 Supabase 後台輪替。
// 帳號（auth.users／profiles）無法從備份還原：找不到對應帳號的 created_by、closed_by、技師綁定會設為 null，
// 之後照 README 第 1 節重建帳號並綁定技師。
import { createClient } from '@supabase/supabase-js'
import { TABLES, readBackup, ask, printCounts, closeInput } from './backup-lib.mjs'

const BATCH = 200
const args = process.argv.slice(2)
const file = args.find((a) => !a.startsWith('--'))
const write = args.includes('--yes')

// 欄位 → 參照 auth.users 的帳號 id
const USER_REFS = { technicians: ['profile_id'], records: ['created_by'], month_closings: ['closed_by'] }
const RESTORE = Object.keys(TABLES).filter((t) => t !== 'profiles')
const conflictKey = (t) => (t === 'month_closings' ? 'month' : 'id')

try {
  if (!file) throw new Error('請指定備份檔：npm run restore -- <檔案>')
  const data = readBackup(file, await ask('備份密碼：', { hidden: true }))
  console.log(`✔ 已解開：${file}`)
  printCounts(data)

  if (!write) {
    console.log('\n（預覽模式，未寫入。確認無誤後設定 SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY 並加 --yes 正式還原）')
  } else {
    await restore(data)
  }
} catch (e) {
  console.error(`✖ ${e.message}`)
  process.exitCode = 1
} finally {
  closeInput()
}

async function restore(data) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('正式還原需要 SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY 環境變數')
  if ((await ask(`確定要寫入 ${url}？輸入 yes 繼續：`)) !== 'yes') throw new Error('已取消')
  const db = createClient(url, key, { auth: { persistSession: false } })

  const { data: users, error } = await db.from('profiles').select('id')
  if (error) throw new Error(`讀取帳號失敗：${error.message}`)
  const existing = new Set(users.map((u) => u.id))
  let unlinked = 0

  // records 先於 month_closings：已結算月份的紀錄會被 trigger 擋下
  for (const t of RESTORE) {
    const rows = data.tables[t].map((r) => {
      const row = { ...r }
      for (const c of USER_REFS[t] ?? []) {
        if (row[c] && !existing.has(row[c])) {
          row[c] = null
          unlinked++
        }
      }
      return row
    })
    for (let i = 0; i < rows.length; i += BATCH) {
      const { error } = await db.from(t).upsert(rows.slice(i, i + BATCH), { onConflict: conflictKey(t) })
      if (error) throw new Error(`寫入 ${t} 失敗：${error.message}${/已結算/.test(error.message) ? '（目標專案該月已結算，請先刪除 month_closings 再還原）' : ''}`)
    }
    console.log(`  ${t.padEnd(15)} ${rows.length} 筆 ✔`)
  }
  console.log('✔ 還原完成')
  if (unlinked) console.log(`⚠ ${unlinked} 個欄位對應的帳號不存在，已設為 null；請照 README 第 1 節重建帳號並綁定技師。`)
}
