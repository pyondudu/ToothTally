// 本機加密備份：用管理者帳密登入，讀出 Supabase 全部資料，以備份密碼加密存成 .ttbk
//
//   npm run backup                        備份到 backups/（不進 repo）
//   npm run backup -- --dir /media/隨身碟  直接備份到指定資料夾
//   npm run backup:check -- <檔案>        驗證備份可解開，印出各表筆數（不寫出明文）
//   npm run backup -- --decrypt <檔案> [--out x.json]   解密成明文 JSON（含病患姓名，用完請刪除）
//
// Supabase 網址與 Publishable key 讀 web/.env（與網頁相同）；不需要也不要使用 secret key。
// 管理者密碼與備份密碼每次輸入，不寫進任何檔案。
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'
import { TABLES, encrypt, readBackup, ask, printCounts, closeInput } from './backup-lib.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const PAGE = 1000

const args = process.argv.slice(2)
const opt = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

function loadEnv() {
  const env = {}
  const file = path.join(ROOT, 'web/.env')
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
  const url = process.env.SUPABASE_URL ?? env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY
  if (!url || !key || key.endsWith('...')) throw new Error('找不到 Supabase 設定：請先建立 web/.env（見 README「本機試用」）')
  return { url, key }
}

async function fetchAll(db, table, orderBy) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from(table).select('*').order(orderBy).range(from, from + PAGE - 1)
    if (error) throw new Error(`讀取 ${table} 失敗：${error.message}`)
    rows.push(...data)
    if (data.length < PAGE) return rows
  }
}

const stamp = () => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date()).map((x) => [x.type, x.value]),
  )
  return `${p.year}-${p.month}-${p.day}-${p.hour}${p.minute}`
}

async function backup() {
  const { url, key } = loadEnv()
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

  console.log(`ToothTally 備份（${url}）`)
  const email = await ask('管理者 Email：')
  const password = await ask('管理者密碼：', { hidden: true })
  const { error: loginError } = await db.auth.signInWithPassword({ email, password })
  if (loginError) throw new Error(`登入失敗：${loginError.message}`)

  try {
    const { data: role, error: roleError } = await db.rpc('my_role')
    if (roleError) throw new Error(`無法確認角色：${roleError.message}`)
    if (role !== 'admin') throw new Error('只有管理者可以備份')

    const tables = {}
    for (const [t, orderBy] of Object.entries(TABLES)) tables[t] = await fetchAll(db, t, orderBy)
    const data = { app: 'ToothTally', version: 1, exportedAt: new Date().toISOString(), project: url, tables }

    console.log('設定備份密碼（之後解開備份要用；遺失就無法還原，請另外妥善保存）')
    const pw = await ask('備份密碼：', { hidden: true })
    if (pw.length < 8) throw new Error('備份密碼至少 8 個字')
    if (pw !== (await ask('再輸入一次：', { hidden: true }))) throw new Error('兩次輸入的備份密碼不同')

    const dir = path.resolve(opt('--dir') ?? path.join(ROOT, 'backups'))
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    const file = path.join(dir, `ToothTally-${stamp()}.ttbk`)
    fs.writeFileSync(file, encrypt(data, pw), { mode: 0o600, flag: 'wx' })

    console.log(`✔ 已備份：${file}`)
    printCounts(data)
    console.log('建議複製一份到隨身碟或外接硬碟。')
  } finally {
    await db.auth.signOut()
  }
}

async function check(file) {
  if (!file) throw new Error('請指定備份檔')
  const data = readBackup(file, await ask('備份密碼：', { hidden: true }))
  console.log(`✔ 備份可正常解開：${file}`)
  printCounts(data)
}

async function decryptToFile(file) {
  if (!file) throw new Error('請指定備份檔')
  const data = readBackup(file, await ask('備份密碼：', { hidden: true }))
  const out = path.resolve(opt('--out') ?? file.replace(/\.ttbk$/, '') + '.backup.json')
  fs.writeFileSync(out, JSON.stringify(data, null, 2), { mode: 0o600, flag: 'wx' })
  console.log(`✔ 已解密：${out}`)
  console.log('⚠ 這個檔案含病患姓名且未加密，用完請刪除，不要上傳或傳送。')
}

try {
  if (args.includes('--check')) await check(opt('--check'))
  else if (args.includes('--decrypt')) await decryptToFile(opt('--decrypt'))
  else await backup()
} catch (e) {
  console.error(`✖ ${e.message}`)
  process.exitCode = 1
} finally {
  closeInput()
}
