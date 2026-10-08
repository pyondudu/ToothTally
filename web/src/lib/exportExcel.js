// 每月業績與獎金 Excel（交給會計；只有管理者可匯出）
//   彙整：各診所營業額、門檻、比例、獎金總額、每位技師獎金（以公式計算，會計可直接核對）
//   ○○明細：每家診所一張，依送回日排序，含病患姓名
// buildWorkbook 不碰瀏覽器 API，可在 Node 測試；exportMonth 負責查資料與下載
import { fmtMonth } from './util'

const COLUMNS = [
  { header: '送回日', key: 'return_date', width: 12, date: true },
  { header: '送件日', key: 'send_date', width: 12, date: true },
  { header: '約診日', key: 'appt_date', width: 12, date: true },
  { header: '醫師', key: 'doctor', width: 8 },
  { header: '患者姓名', key: 'patient_name', width: 12 },
  { header: '項目', key: 'item', width: 16 },
  { header: '牙位', key: 'tooth', width: 14 },
  { header: '顆數', key: 'qty', width: 7, num: '0' },
  { header: '單價', key: 'unit_price', width: 9, num: '#,##0' },
  { header: '金額', key: 'amount', width: 11, num: '#,##0' },
  { header: '技師', key: 'technician', width: 8 },
  { header: '備註', key: 'note', width: 28 },
]
const AMOUNT_COL = 'J' // 金額欄（COLUMNS 第 10 欄）
const MONEY = '#,##0'
const HEAD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDFF4EF' } }
const BOLD = { bold: true }

// 'YYYY-MM-DD' → Excel 日期（ExcelJS 以 UTC 寫入）
const toDate = (s) => {
  if (!s) return null
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

const sheetName = (clinic) => `${clinic}明細`
const quote = (name) => `'${name}'`

/**
 * @param ExcelJS  ExcelJS 模組
 * @param data { month, closedAt, clinics: [{id,name}], records: [...], bonus, technicians: [name], exportedAt }
 */
export function buildWorkbook(ExcelJS, data) {
  const { month, closedAt, clinics, records, bonus, technicians, exportedAt } = data
  const wb = new ExcelJS.Workbook()
  wb.creator = 'ToothTally'
  wb.created = exportedAt
  // 開啟時重新計算公式（會計改了數字也會跟著更新）
  wb.calcProperties.fullCalcOnLoad = true

  const sum = wb.addWorksheet('彙整', { views: [{ showGridLines: false }] })

  // ── 各診所明細 ──
  const totals = clinics.map((c) => {
    const rows = records
      .filter((r) => r.clinic_id === c.id)
      .sort((a, b) => (a.return_date ?? '').localeCompare(b.return_date ?? '') || (a.send_date ?? '').localeCompare(b.send_date ?? ''))
    const ws = wb.addWorksheet(sheetName(c.name), { views: [{ state: 'frozen', ySplit: 1 }] })
    ws.columns = COLUMNS.map(({ header, key, width }) => ({ header, key, width }))
    for (const r of rows) {
      ws.addRow({
        return_date: toDate(r.return_date), send_date: toDate(r.send_date), appt_date: toDate(r.appt_date),
        doctor: r.doctor?.name ?? '', patient_name: r.patient_name ?? '', item: r.item?.name ?? '', tooth: r.tooth ?? '',
        qty: Number(r.qty), unit_price: Number(r.unit_price), amount: Number(r.amount),
        technician: r.technician?.name ?? '', note: r.note ?? '',
      })
    }
    COLUMNS.forEach((col, i) => {
      const column = ws.getColumn(i + 1)
      if (col.date) column.numFmt = 'yyyy/mm/dd'
      if (col.num) column.numFmt = col.num
    })
    const head = ws.getRow(1)
    head.font = BOLD
    head.eachCell((cell) => { cell.fill = HEAD_FILL })
    ws.autoFilter = { from: 'A1', to: `L${Math.max(1, rows.length + 1)}` }

    const amount = rows.reduce((s, r) => s + Number(r.amount), 0)
    const last = rows.length + 1
    const totalRow = ws.addRow({ patient_name: `合計 ${rows.length} 筆` })
    totalRow.getCell('amount').value = rows.length ? { formula: `SUM(${AMOUNT_COL}2:${AMOUNT_COL}${last})`, result: amount } : 0
    totalRow.font = BOLD
    return { name: c.name, amount, count: rows.length, ref: `${quote(sheetName(c.name))}!${AMOUNT_COL}${totalRow.number}` }
  })

  // ── 彙整 ──
  sum.columns = [{ width: 22 }, { width: 16 }, { width: 10 }]
  sum.addRow(['ToothTally 業績與獎金']).font = { bold: true, size: 14 }
  sum.addRow([fmtMonth(month)]).font = { bold: true, size: 12 }
  const status = sum.addRow([closedAt ? `已結算（${closedAt.slice(0, 10)}）` : '未結算：數字可能還會變動'])
  status.font = { bold: true, color: { argb: closedAt ? 'FF23805A' : 'FFC2412D' } }
  sum.addRow([])

  const h = sum.addRow(['診所', '營業額', '筆數'])
  h.font = BOLD
  h.eachCell((cell) => { cell.fill = HEAD_FILL })
  const firstClinicRow = h.number + 1
  for (const t of totals) {
    const row = sum.addRow([t.name, { formula: t.ref, result: t.amount }, t.count])
    row.getCell(2).numFmt = MONEY
  }
  const total = totals.reduce((s, t) => s + t.amount, 0)
  const count = totals.reduce((s, t) => s + t.count, 0)
  const lastClinicRow = firstClinicRow + totals.length - 1
  const totalRow = sum.addRow(['合計', { formula: `SUM(B${firstClinicRow}:B${lastClinicRow})`, result: total }, count])
  totalRow.font = BOLD
  totalRow.getCell(2).numFmt = MONEY
  sum.addRow([])

  if (!bonus) {
    sum.addRow(['這個月份沒有獎金設定'])
  } else {
    const T = totalRow.number
    const put = (label, value, fmt) => {
      const row = sum.addRow([label, value])
      if (fmt) row.getCell(2).numFmt = fmt
      return row.number
    }
    const rThreshold = put('門檻', Number(bonus.threshold), MONEY)
    const rRate = put('比例', Number(bonus.rate), '0%')
    const rMax = put('未達門檻最多倒扣（兩人合計）', Number(bonus.max_deduction), MONEY)
    const rBonus = put('獎金總額', { formula: `ROUND(MAX((B${T}-B${rThreshold})*B${rRate},-B${rMax}),0)`, result: Number(bonus.bonus_total) }, MONEY)
    sum.getRow(rBonus).font = BOLD
    const rShare = put('每位技師比例', Number(bonus.share), '0%')
    sum.addRow([])
    const th = sum.addRow(['技師', '獎金'])
    th.font = BOLD
    th.eachCell((cell) => { cell.fill = HEAD_FILL })
    for (const name of technicians) {
      put(name, { formula: `ROUND(B${rBonus}*B${rShare},0)`, result: Number(bonus.per_person) }, MONEY)
    }
    sum.addRow([])
    sum.addRow(['公式：獎金總額 = MAX((合計 − 門檻) × 比例, −最多倒扣)；每位技師 = 獎金總額 × 每位技師比例'])
  }
  sum.addRow(['營業額依「送回日」歸月；尚未送回的紀錄不計入。'])
  sum.addRow([`匯出時間：${exportedAt.toLocaleString('zh-TW', { hour12: false })}`]).font = { color: { argb: 'FF5F6C6A' } }

  return wb
}

// ── 瀏覽器：查詢當月資料、產生並下載 ──
export async function exportMonth({ supabase, store, month, closing, bonus, recordSelect }) {
  const { data: records, error } = await supabase.from('records').select(recordSelect).eq('month', month)
  if (error) throw error
  const { default: ExcelJS } = await import('exceljs/dist/exceljs.min.js')
  const wb = buildWorkbook(ExcelJS, {
    month,
    closedAt: closing?.closed_at ?? null,
    clinics: store.clinics,
    records,
    bonus,
    technicians: store.technicians.filter((t) => t.active).map((t) => t.name),
    exportedAt: new Date(),
  })
  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `ToothTally_${month.slice(0, 7)}_業績獎金${closing ? '' : '_未結算'}.xlsx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
