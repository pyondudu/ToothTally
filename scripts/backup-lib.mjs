// 備份共用：.ttbk 加解密、終端機輸入（backup.mjs、restore.mjs 共用）
//
// .ttbk 格式：'TTBK1'(5) + salt(16) + iv(12) + authTag(16) + AES-256-GCM(gzip(JSON))
// 金鑰由備份密碼經 scrypt 導出；密碼遺失就無法解開，沒有後門。
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import fs from 'node:fs'
import readline from 'node:readline'

// 備份的資料表，依外鍵順序（還原時照這個順序寫入）；值為分頁排序欄位
export const TABLES = {
  clinics: 'id', doctors: 'id', technicians: 'id', price_items: 'id', bonus_settings: 'id',
  records: 'id', month_closings: 'month', profiles: 'id',
}

const MAGIC = Buffer.from('TTBK1')
const SCRYPT = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }

const deriveKey = (password, salt) => crypto.scryptSync(password.normalize('NFC'), salt, 32, SCRYPT)

export function encrypt(obj, password) {
  const salt = crypto.randomBytes(16)
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(password, salt), iv)
  const body = Buffer.concat([cipher.update(zlib.gzipSync(JSON.stringify(obj))), cipher.final()])
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), body])
}

export function decrypt(buf, password) {
  if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('不是 ToothTally 備份檔（.ttbk）')
  let o = MAGIC.length
  const salt = buf.subarray(o, (o += 16))
  const iv = buf.subarray(o, (o += 12))
  const tag = buf.subarray(o, (o += 16))
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(password, salt), iv)
  decipher.setAuthTag(tag)
  let plain
  try {
    plain = Buffer.concat([decipher.update(buf.subarray(o)), decipher.final()])
  } catch {
    throw new Error('密碼錯誤或檔案損毀')
  }
  return JSON.parse(zlib.gunzipSync(plain).toString('utf8'))
}

export const readBackup = (file, password) => decrypt(fs.readFileSync(file), password)

// 終端機輸入；hidden = true 時不顯示輸入內容（密碼）。整個程式共用一個 readline，結束前呼叫 closeInput()
// 先到的行排隊等待，可用管線輸入（測試用）
let rl, muted = false, ended = false
const lines = [], waiting = []
function input() {
  if (rl) return
  rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY })
  const write = rl._writeToOutput.bind(rl)
  rl._writeToOutput = (s) => (!muted || s === '\r\n' || s === '\n') && write(s)
  rl.on('line', (l) => (waiting.length ? waiting.shift().resolve(l) : lines.push(l)))
  rl.on('close', () => {
    ended = true
    for (const w of waiting.splice(0)) w.reject(new Error('輸入已結束，已取消'))
  })
}
export async function ask(question, { hidden = false } = {}) {
  input()
  muted = false
  process.stdout.write(question)
  muted = hidden
  try {
    const a = lines.length ? lines.shift() : ended ? Promise.reject(new Error('輸入已結束，已取消')) : await new Promise((resolve, reject) => waiting.push({ resolve, reject }))
    return hidden ? await a : (await a).trim() // 密碼不去頭尾空白
  } finally {
    muted = false
  }
}
export const closeInput = () => rl?.close()

export function printCounts(data) {
  console.log(`  匯出時間：${new Date(data.exportedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`)
  console.log(`  來源專案：${data.project}`)
  for (const [t, rows] of Object.entries(data.tables)) console.log(`  ${t.padEnd(15)} ${rows.length} 筆`)
}
