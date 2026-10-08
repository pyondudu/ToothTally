// 舊資料匯入：把 import/ 下的兩家診所 Excel（11505～11509）與 Google 表單回覆匯入 Supabase。
//
//   node scripts/import.mjs --dry-run   只讀檔、印出各月合計與預計獎金，不連資料庫
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/import.mjs
//
// service_role key 只放在本機環境變數，不要寫進任何檔案。
// 以 import_key（檔名:工作表:列號／form:時間戳記）upsert，可重複執行。
import ExcelJS from 'exceljs'
import { createClient } from '@supabase/supabase-js'
import path from 'node:path'
import fs from 'node:fs'

const IMPORT_DIR = process.env.IMPORT_DIR ?? path.resolve(import.meta.dirname, '../import')
const CLINIC_FILES = [
  { clinic: '正光', file: '正光一日假牙登記表(115-09).xlsx' },
  { clinic: '小檜溪', file: '小檜溪一日假牙登記表(115-09).xlsx' },
]
const FORM_FILE = '工作紀錄表 的副本 (回覆).xlsx'
const SHEET_FROM = '11505'
const SHEET_TO = '11509'

// 目前價目（與 supabase/schema.sql 種子資料一致），dry-run 與表單回覆帶金額用
const PRICES = {
  'temp': 800, '3D列印temp': 800, 'zr(前牙)': 2800, 'zr(後牙)': 2300,
  'IP zr(前牙)': 4000, 'IP zr(後牙)': 3500, 'E.max(前牙)': 3500, 'E.max': 3000,
  '維持器': 1000, '咬合板': 1500, '3D模型列印': 800, '手術導板': 1500,
  'ALL ON Denture': 3000, '數位排牙': 100, '委外客製化ABUTMENT': 0, 'Denture': 3000,
}
// 舊資料中的別名 → 價目名稱
const ITEM_ALIASES = {}

// 獎金設定（與 schema.sql 種子資料一致），dry-run 試算用
const BONUS = { threshold: 178000, rate: 0.4, maxDeduction: 3000, share: 0.5 }

const dryRun = process.argv.includes('--dry-run')

// ── 儲存格讀值 ──
function raw(cell) {
  let v = cell?.value
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in v) v = v.result
    else if ('richText' in v) v = v.richText.map(t => t.text).join('')
    else if ('text' in v) v = v.text
    else if ('formula' in v || 'sharedFormula' in v) v = undefined
  }
  if (v && typeof v === 'object' && 'error' in v) v = undefined
  return v === '' ? undefined : v
}
const text = c => {
  const v = raw(c)
  if (v == null) return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v).trim() || null
}
const num = c => {
  const v = raw(c)
  if (v == null) return null
  const n = Number(v)
  if (!Number.isFinite(n)) throw new Error(`不是數字：${v}`)
  return n
}
// Excel 日期：exceljs 對日期格式回傳 Date（UTC），其他情況可能是序號
function date(c) {
  const v = raw(c)
  if (v == null) return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'number') return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10)
  throw new Error(`不是日期：${v}`)
}
const monthOf = d => d.slice(0, 8) + '01'
// 工作表名稱 11505 → 2026-05-01
const sheetMonth = name => `${Number(name.slice(0, 3)) + 1911}-${name.slice(3, 5)}-01`

async function readBook(file) {
  const p = path.join(IMPORT_DIR, file)
  if (!fs.existsSync(p)) throw new Error(`找不到 ${p}`)
  const wb = new ExcelJS.Workbook()
  try {
    await wb.xlsx.readFile(p)
  } catch (e) {
    throw new Error(`無法讀取 ${file}（檔案可能損毀，請重新放一份）：${e.message}`)
  }
  return wb
}

// ── 診所 Excel：B 送件日 C 約診日 D 醫師 E 患者 F 材質 G 牙位 H 單價 I 顆數 J 金額 K bouns(忽略) L 送回日 M 備註 N 技師 ──
async function readClinic({ clinic, file }) {
  const wb = await readBook(file)
  const rows = []
  for (const ws of wb.worksheets) {
    if (!/^\d{5}$/.test(ws.name) || ws.name < SHEET_FROM || ws.name > SHEET_TO) continue
    if (text(ws.getCell('B4')) !== '送件日') throw new Error(`${file} ${ws.name}：第 4 列表頭不是預期的「送件日」版面`)
    const month = sheetMonth(ws.name)
    ws.eachRow((row, r) => {
      if (r < 5) return
      const c = col => row.getCell(col)
      const patient = text(c('E')), item = text(c('F'))
      if (!patient && !item) return
      if (patient === '以下空白') return
      const where = `${file} ${ws.name}!${r}`
      try {
        rows.push({
          where,
          import_key: `${clinic}:${ws.name}:${r}`,
          month, clinic,
          send_date: date(c('B')), appt_date: date(c('C')), return_date: date(c('L')),
          doctor: text(c('D')), patient_name: patient, item: item && (ITEM_ALIASES[item] ?? item),
          tooth: text(c('G')), qty: num(c('I')) ?? 1, unit_price: num(c('H')) ?? 0, amount: num(c('J')) ?? 0,
          technician: text(c('N')), note: text(c('M')),
        })
      } catch (e) {
        throw new Error(`${where}：${e.message}`)
      }
    })
  }
  return rows
}

// ── 表單回覆：時間戳記、診所(第 1 欄)、送件日、約診日、醫師姓名、患者姓名、材質(第 6 欄)、牙位、顆數、送回日、技師、備註 ──
async function readForm() {
  const wb = await readBook(FORM_FILE)
  const ws = wb.worksheets[0]
  const head = {}
  ws.getRow(1).eachCell((cell, col) => { head[text(cell)] = col })
  const need = ['時間戳記', '第 1 欄', '送件日', '約診日', '醫師姓名', '患者姓名', '第 6 欄', '牙位', '顆數', '送回日', '技師', '備註']
  for (const h of need) if (!head[h]) throw new Error(`${FORM_FILE} 缺少欄位「${h}」`)
  const rows = []
  ws.eachRow((row, r) => {
    if (r < 2) return
    const c = h => row.getCell(head[h])
    const stamp = raw(c('時間戳記'))
    if (!stamp) return
    const stampIso = stamp instanceof Date ? stamp.toISOString() : String(stamp)
    const item = text(c('第 6 欄'))
    const mapped = item && (ITEM_ALIASES[item] ?? item)
    const qty = num(c('顆數')) ?? 1
    const unit = PRICES[mapped] ?? 0
    const ret = date(c('送回日'))
    rows.push({
      where: `${FORM_FILE}!${r}`,
      import_key: `form:${stampIso}`,
      // 依送回日；尚未送回 → null（不計入營業額，補填送回日後才歸月）
      month: ret ? monthOf(ret) : null,
      clinic: text(c('第 1 欄')),
      send_date: date(c('送件日')), appt_date: date(c('約診日')), return_date: ret,
      doctor: text(c('醫師姓名')), patient_name: text(c('患者姓名')), item: mapped,
      tooth: text(c('牙位')), qty, unit_price: unit, amount: qty * unit,
      technician: text(c('技師')), note: text(c('備註')),
    })
  })
  return rows
}

function calcBonus(total) {
  const bonus = Math.round(Math.max((total - BONUS.threshold) * BONUS.rate, -BONUS.maxDeduction))
  return { bonus, perPerson: Math.round(bonus * BONUS.share) }
}

function report(rows) {
  const fmt = n => n.toLocaleString('en-US')
  const byMonth = new Map()
  for (const r of rows) {
    if (!r.month) continue
    const m = byMonth.get(r.month) ?? { total: 0, count: 0, clinics: new Map() }
    const c = m.clinics.get(r.clinic) ?? { count: 0, amount: 0 }
    c.count++; c.amount += r.amount; m.count++; m.total += r.amount
    m.clinics.set(r.clinic, c); byMonth.set(r.month, m)
  }
  console.log('\n月份      ' + CLINIC_FILES.map(f => f.clinic.padEnd(14)).join('') + '合計        獎金總額   每人')
  for (const [month, m] of [...byMonth].sort()) {
    const cells = CLINIC_FILES.map(({ clinic }) => {
      const c = m.clinics.get(clinic)
      return (c ? `${fmt(c.amount)} (${c.count})` : '-').padEnd(16)
    }).join('')
    const { bonus, perPerson } = calcBonus(m.total)
    console.log(`${month.slice(0, 7)}   ${cells}${fmt(m.total).padEnd(12)}${fmt(bonus).padEnd(11)}${fmt(perPerson)}`)
  }

  const count = key => {
    const map = new Map()
    for (const r of rows) {
      const k = typeof key === 'function' ? key(r) : r[key]
      map.set(k, (map.get(k) ?? 0) + 1)
    }
    return [...map].map(([k, n]) => `${k ?? '（空白）'}×${n}`).join('、')
  }
  console.log('\n醫師：' + count('doctor'))
  console.log('技師：' + count('technician'))
  const unknown = rows.filter(r => !r.item || !(r.item in PRICES))
  if (unknown.length) {
    console.log('\n⚠ 價目表沒有的材質：')
    for (const r of unknown) console.log(`  ${r.where}  「${r.item ?? ''}」 ${r.patient_name ?? ''}`)
  }
  const noReturn = rows.filter(r => !r.return_date)
  if (noReturn.length) console.log(`\n尚未送回（不計入營業額）：${noReturn.map(r => `${r.where} ${r.patient_name}`).join('、')}`)
  const formRows = rows.filter(r => r.import_key.startsWith('form:'))
  if (formRows.length) {
    console.log('\n表單回覆：')
    for (const r of formRows) console.log(`  ${r.month?.slice(0, 7) ?? '未送回 '} ${r.clinic} ${r.patient_name} ${r.item} ${r.qty}×${r.unit_price}=${r.amount}`)
  }
  return unknown
}

// ── 寫入 Supabase ──
async function upload(rows) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('請先設定環境變數 SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY')
  const db = createClient(url, key, { auth: { persistSession: false } })
  const must = ({ data, error }) => { if (error) throw new Error(error.message); return data }

  const clinics = new Map(must(await db.from('clinics').select('id,name')).map(c => [c.name, c.id]))
  const items = new Map(must(await db.from('price_items').select('id,name').is('clinic_id', null)).map(i => [i.name, i.id]))

  const doctors = new Map(must(await db.from('doctors').select('id,name')).map(d => [d.name, d.id]))
  const newDoctors = [...new Set(rows.map(r => r.doctor).filter(Boolean))].filter(n => !doctors.has(n)).map(name => ({ name }))
  if (newDoctors.length) for (const d of must(await db.from('doctors').insert(newDoctors).select('id,name'))) doctors.set(d.name, d.id)

  const techs = new Map(must(await db.from('technicians').select('id,name')).map(t => [t.name, t.id]))
  const newTechs = [...new Set(rows.map(r => r.technician).filter(Boolean))].filter(n => !techs.has(n)).map(name => ({ name }))
  if (newTechs.length) for (const t of must(await db.from('technicians').insert(newTechs).select('id,name'))) techs.set(t.name, t.id)

  const records = rows.map(r => {
    const clinic_id = clinics.get(r.clinic)
    if (!clinic_id) throw new Error(`${r.where}：找不到診所「${r.clinic}」`)
    return {
      import_key: r.import_key, source: 'import', month: r.month, clinic_id,
      send_date: r.send_date, appt_date: r.appt_date, return_date: r.return_date,
      doctor_id: r.doctor ? doctors.get(r.doctor) : null,
      patient_name: r.patient_name, tooth: r.tooth, item_id: items.get(r.item) ?? null,
      qty: r.qty, unit_price: r.unit_price, amount: r.amount,
      technician_id: r.technician ? techs.get(r.technician) : null, note: r.note,
    }
  })
  for (let i = 0; i < records.length; i += 200) {
    must(await db.from('records').upsert(records.slice(i, i + 200), { onConflict: 'import_key' }))
  }
  console.log(`\n已寫入 ${records.length} 筆。核對：`)
  const summary = must(await db.from('monthly_summary').select('month,record_count,total,bonus_total,per_person').order('month'))
  console.table(summary)
}

async function main() {
  const rows = []
  for (const f of CLINIC_FILES) {
    try {
      rows.push(...await readClinic(f))
    } catch (e) {
      // dry-run 時讀不到的檔案先跳過，方便檢查其他檔案；正式匯入一律中止
      if (!dryRun) throw e
      console.error(`⚠ 略過：${e.message}`)
    }
  }
  rows.push(...await readForm())
  const unknown = report(rows)
  if (dryRun) return
  if (unknown.length) throw new Error('有材質對應不到價目表，請在 ITEM_ALIASES 補對應或在 schema.sql 新增項目後再匯入')
  await upload(rows)
}

main().catch(e => { console.error('\n✖ ' + e.message); process.exit(1) })
