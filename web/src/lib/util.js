// 技師用帳號名稱登入：Supabase 需要 Email，輸入沒有 @ 時補上這個假網域
// （例：帳號 abc → abc@toothtally.local；在 Supabase 建帳號時也用這個格式）
export const LOGIN_DOMAIN = 'toothtally.local'
export function toLoginEmail(input) {
  const v = input.trim().toLowerCase()
  return v.includes('@') ? v : `${v}@${LOGIN_DOMAIN}`
}

const pad = (n) => String(n).padStart(2, '0')

function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// 月份一律用該月 1 日表示（'2026-10-01'），與資料庫 records.month 相同
export function monthOf(dateStr) {
  return dateStr.slice(0, 8) + '01'
}
export function thisMonth() {
  return monthOf(todayStr())
}
export function addMonths(month, n) {
  const d = parseDate(month)
  d.setMonth(d.getMonth() + n)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`
}
export function fmtMonth(month) {
  const [y, m] = month.split('-').map(Number)
  return `${y} 年 ${m} 月`
}
// 網址用的短格式：2026-10
export const monthParam = (month) => month.slice(0, 7)
export const fromMonthParam = (s) => (/^\d{4}-\d{2}$/.test(s ?? '') ? `${s}-01` : null)

const WEEK = '日一二三四五六'
export function fmtDate(s) {
  if (!s) return '—'
  const d = parseDate(s)
  return `${d.getMonth() + 1}/${d.getDate()}（${WEEK[d.getDay()]}）`
}

export function fmtMoney(n) {
  if (n === null || n === undefined || n === '') return '—'
  return Math.round(Number(n)).toLocaleString('zh-TW')
}

export function isEmpty(v) {
  return v === null || v === undefined || String(v).trim() === ''
}

// 比例 0.4 → '40%'（避免浮點誤差顯示成 40.00000000000001）
export function fmtPct(rate) {
  return `${+(Number(rate) * 100).toFixed(2)}%`
}
