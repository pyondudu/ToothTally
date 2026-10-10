// 個資外洩檢查：部署、git commit／push 前執行 `npm run check-privacy`
//   1. 不可上傳的路徑（import/、backups/、.env、根目錄截圖…）不能出現在待上傳清單
//   2. 從 import/ 的舊 Excel 取出所有病患姓名，加上 .privacy-terms 的自訂敏感詞，逐一比對待上傳的檔案內容
// 待上傳清單：在 git repo 中為「已追蹤＋已暫存＋未忽略的新檔」；否則為專案內所有未被 .gitignore 排除的檔案
// 有任何問題就以非 0 結束，git hook 會因此擋下 commit。
import ExcelJS from 'exceljs'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const IMPORT_DIR = path.join(ROOT, 'import')

// 絕對不能上傳的路徑
const FORBIDDEN = [
  /^import\//,
  /(^|\/)\.env$/,
  /^[^/]+\.(png|jpe?g|webp|heic|xlsx|xls|csv)$/i, // 根目錄的截圖、試算表
  /\.(xlsx|xls|csv)$/i,                           // 任何位置的試算表
  /(^|\/)backups\//, /\.ttbk$/i, /\.backup\.json$/i, // 備份檔
]

function filesToUpload() {
  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd: ROOT, stdio: 'ignore' })
    const out = execSync('git ls-files --cached --others --exclude-standard -z', { cwd: ROOT })
    return out.toString().split('\0').filter(Boolean)
  } catch {
    // 還不是 git repo：自己走訪目錄，套用最基本的排除
    const skip = new Set(['node_modules', 'dist', '.git', 'import', 'backups'])
    const list = []
    const walk = (dir) => {
      for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        if (skip.has(e.name)) continue
        const rel = dir ? `${dir}/${e.name}` : e.name
        if (e.isDirectory()) walk(rel)
        else list.push(rel)
      }
    }
    walk('')
    return list
  }
}

// 儲存格文字：格式化文字（richText）與公式結果也要取出，否則會變成 [object Object] 而漏比對
function cellText(cell) {
  let v = cell?.value
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if (Array.isArray(v.richText)) v = v.richText.map((t) => t.text).join('')
    else if ('result' in v) v = v.result
    else if ('text' in v) v = v.text
    else v = ''
  }
  return String(v ?? '').trim()
}

// 從舊 Excel 與表單回覆取出病患姓名（「患者姓名」欄）
async function patientNames() {
  if (!fs.existsSync(IMPORT_DIR)) return null
  const names = new Set()
  for (const f of fs.readdirSync(IMPORT_DIR).filter((f) => f.endsWith('.xlsx'))) {
    const wb = new ExcelJS.Workbook()
    try {
      await wb.xlsx.readFile(path.join(IMPORT_DIR, f))
    } catch {
      console.warn(`⚠ 無法讀取 import/${f}，略過`)
      continue
    }
    wb.eachSheet((ws) => {
      ws.eachRow((row) => {
        row.eachCell((cell, col) => {
          if (cellText(cell) !== '患者姓名') return
          // 找到表頭後，往下讀同一欄
          for (let r = row.number + 1; r <= ws.rowCount; r++) {
            const v = cellText(ws.getRow(r).getCell(col))
            if (v.length >= 2 && !['以下空白', '患者姓名'].includes(v) && !/^[\d\s.]+$/.test(v)) names.add(v)
          }
        })
      })
    })
  }
  return names
}

const problems = []
const files = filesToUpload()

for (const f of files) {
  if (FORBIDDEN.some((re) => re.test(f))) problems.push(`不可上傳的檔案：${f}`)
}

const names = await patientNames()
// 自訂敏感詞（Email、技師與醫師名字等），每行一個，# 開頭為註解；檔案本身不進 repo
const TERMS_FILE = path.join(ROOT, '.privacy-terms')
if (names && fs.existsSync(TERMS_FILE)) {
  for (const t of fs.readFileSync(TERMS_FILE, 'utf8').split('\n').map((l) => l.trim())) if (t && !t.startsWith('#')) names.add(t)
} else if (!fs.existsSync(TERMS_FILE)) {
  console.warn('⚠ 找不到 .privacy-terms（自訂敏感詞），只比對病患姓名')
}
if (!names) {
  console.warn('⚠ 找不到 import/，無法比對病患姓名（只檢查了檔案路徑）')
} else {
  for (const f of files) {
    const p = path.join(ROOT, f)
    if (!fs.existsSync(p) || fs.statSync(p).size > 5_000_000) continue
    const buf = fs.readFileSync(p)
    if (buf.includes(0)) continue // 二進位檔（圖片等）
    const text = buf.toString('utf8')
    for (const n of names) if (text.includes(n)) problems.push(`${f} 含有個資「${n}」`)
  }
}

if (problems.length) {
  console.error('✖ 個資檢查未通過：')
  for (const p of problems) console.error('  ' + p)
  process.exit(1)
}
console.log(`✔ 個資檢查通過：${files.length} 個待上傳檔案，比對 ${names?.size ?? 0} 個病患姓名與敏感詞，未發現個資`)
