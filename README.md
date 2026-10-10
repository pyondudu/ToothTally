# ToothTally — 牙技業績統計

兩位牙技師登記正光、小檜溪兩家診所的業績，自動彙整每月營業額並計算獎金。手機、電腦都能用，可加到手機主畫面。

| 元件 | 說明 |
|---|---|
| `supabase/schema.sql` | 資料庫結構、權限（RLS）、獎金計算、月份結算鎖定、診所與價目種子資料（可重複執行；技師與醫師名單不在 repo） |
| `web/` | 網頁（Vue 3 + Vite，PWA） |
| `scripts/import.mjs` | 舊 Excel 一次性匯入（本機執行） |
| `scripts/backup.mjs`、`scripts/restore.mjs` | 本機加密備份與還原 |
| `scripts/check-privacy.mjs` | 個資外洩檢查（git commit／push 前自動執行） |
| `scripts/make-icons.mjs` | 由 `web/src/components/toothSprite.js` 產生 app 圖示 |
| `.github/workflows/deploy-web.yml` | push `web/` 變更時自動部署 GitHub Pages |
| `.github/workflows/keepalive.yml` | 每天呼叫 Supabase 一次，避免免費方案閒置 7 天被暫停 |

## ⚠ 個資

資料含病患姓名，**只存在 Supabase**，不在這個 repo 裡。

- `import/`（舊 Excel）、`.env`、截圖、`HANDOFF.md`、`supabase/seed.local.sql`（技師與醫師名單）、`.privacy-terms` 都被 `.gitignore` 排除。
- `npm install` 會把 git hook 指向 `.githooks/`：每次 commit／push 前執行 `npm run check-privacy`，從 `import/` 的舊 Excel 取出所有病患姓名，再加上 `.privacy-terms`（每行一個自訂敏感詞，例如 Email、技師與醫師名字），比對每個待上傳檔案，發現就擋下。
- 網頁裡的 Publishable key 是設計上可公開的金鑰；資料由 RLS 保護，未登入者讀不到任何資料。
- 備份檔只存在本機 `backups/`（或隨身碟），以備份密碼 AES-256 加密；見第 5 節。
- 管理者匯出的 Excel 含病患姓名，只在瀏覽器產生下載、不會上傳；交給會計時請用私訊或內部信箱。

## 獎金公式

```
當月合計 = 正光 + 小檜溪（依「送回日」歸月；未送回的不計）
獎金總額 = max((當月合計 − 門檻) × 比例, −最多倒扣)
每人獎金 = 獎金總額 × 50%（兩位技師各半；管理者不分紅）
```
目前（2026-05 起）：門檻 178,000、比例 40%、未達門檻兩人合計最多倒扣 3,000。可在「設定」頁新增某月起的新設定，舊月份照當時設定計算。

## 角色

| 功能 | 管理者（admin，Email 登入） | 技師（staff，帳號登入） |
|---|---|---|
| 新增登記、檢視全部紀錄與獎金 | ✅ | ✅ |
| 補填「未送回」紀錄的送回日 | ✅ | ✅ |
| 修改／刪除紀錄 | ✅ | ❌ |
| 價目表、醫師、獎金設定、月份結算、匯出 Excel | ✅ | ❌ |

已結算的月份任何人都不能新增、修改或刪除（資料庫 trigger 擋下）。

## 功能

- **總覽**：切換月份；正光、小檜溪、合計、距門檻還差／已超過、獎金總額與每人獎金；牙齒吉祥物依每人獎金換表情（倒扣難過／一般／超過 1 萬開心／超過 2 萬興奮），已結算顯示勾勾；未送回的筆數依登記月份提示。管理者可結算／取消結算當月、匯出 Excel。
- **登記**：欄位同原本的 Google 表單；選項目自動帶出單價，金額＝顆數×單價（可手動改）；必填缺漏標紅並捲動到該欄；成功後顯示綠色提示與「我最近登記的」清單，可一鍵「同一位病患再登記一筆」。
- **紀錄**：依月份或「未送回」檢視；依診所、醫師、技師、項目篩選，搜尋病患；未送回的可補填送回日；管理者可修改、刪除。
- **設定**（管理者）：價目表（改價、停用、新增）、醫師名單、獎金設定（某月起生效）。
- **匯出 Excel**（管理者）：彙整（各診所營業額、門檻、比例、獎金，皆為公式）＋各診所明細；未結算月份會標示。

---

## 1. Supabase 設定（一次性，已完成）

> 本專案：`https://udiskrebefeeoadjzfto.supabase.co`（Tokyo）

1. 建立專案（Free、Region：Northeast Asia (Tokyo)）。
2. **SQL Editor** 貼上 `supabase/schema.sql` 全部內容 → **Run**。
3. **Authentication → Users → Add user → Create new user**，勾選 **Auto Confirm User**：
   - 管理者：自己的 Email
   - 技師（兩位）：`<帳號>@toothtally.local` — 登入時只要輸入 `<帳號>`
4. SQL Editor 執行 `supabase/seed.local.sql`（技師、醫師名單；不在 repo 內，由管理者保存），再設定角色與綁定技師：
   ```sql
   update public.profiles set role = 'admin' where email = '<你的Email>';
   update public.technicians set profile_id = (select id from public.profiles where email = '<帳號>@toothtally.local') where name = '<技師名>';
   select p.email, p.role, t.name as 技師 from profiles p left join technicians t on t.profile_id = p.id;
   ```
5. **Authentication → Sign In / Providers**：關閉 **Allow new users to sign up**。
6. **Project Settings → API Keys**：複製 **Publishable key**（`sb_publishable_…`）給網頁用。**Secret key 不要放進任何檔案**，只有匯入時臨時使用，用完即刪。

## 2. 網頁

### 本機試用
```bash
cd web
cp .env.example .env     # 填入 Publishable key
npm install
npm run dev
```

### 部署（GitHub Pages）
1. Repo → Settings → Secrets and variables → Actions：新增 `SUPABASE_URL`、`SUPABASE_ANON_KEY`（Publishable key）。
2. Repo → Settings → Pages → Source 選 **GitHub Actions**。
3. 推送 `web/` 的變更或手動執行 Actions → **Deploy web**。
4. Supabase → **Authentication → URL Configuration**：把網站網址加入 *Site URL* 與 *Redirect URLs*（Email 連結登入才會導回網站）。

### 保持 Supabase 活躍
Supabase 免費方案連續 7 天沒有活動會暫停。`keepalive.yml` 每天 09:17（台灣時間）呼叫資料庫的 `public.ping()`（只回傳 `ok`，不讀任何資料），並重新啟用自己，避免 repo 60 天沒更新時被 GitHub 停用排程。執行失敗時 GitHub 會寄信通知；若 Supabase 已暫停，到後台按 Restore 即可恢復，資料不會遺失。

### 手機加到主畫面
- iPhone：Safari 開啟 → 分享 → 加入主畫面
- Android：Chrome 開啟 → 選單 → 安裝應用程式／加到主畫面

## 3. 舊資料匯入（已完成，2026-10-08 匯入 434 筆）

```bash
npm install
npm run import:dry                       # 只讀檔，印出各月合計與預計獎金
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run import   # 正式匯入（可重跑，不會重複）
```
舊 Excel 放在 `import/`（不進 repo）。只匯入 115/05～115/09 工作表與表單回覆。

## 4. 圖示

角色像素圖的唯一來源是 `web/src/components/toothSprite.js`，改完執行 `npm run icons` 重新產生 `web/public/icon.svg`、`icon-192.png`、`icon-512.png`。畫面上的吉祥物元件是 `web/src/components/ToothBuddy.vue`（表情依每人獎金：倒扣難過／1 萬以內一般／超過 1 萬開心／超過 2 萬興奮；已結算另外顯示勾勾）。

## 5. 備份與還原

Supabase 免費方案沒有可下載的自動備份，請**每月結算後**在本機備份一次，並複製一份到隨身碟或外接硬碟。

```bash
npm run backup                            # 管理者 Email＋密碼登入 → 設定備份密碼 → backups/ToothTally-日期.ttbk
npm run backup -- --dir /media/<隨身碟>    # 直接存到隨身碟
npm run backup:check -- <檔案>            # 驗證備份能解開、印出各表筆數（不寫出明文）
```
- 讀取 `web/.env` 的網址與 Publishable key，以管理者身分透過 RLS 讀取全部資料；**不需要 secret key**，密碼都不會存檔。
- 管理者若一直用 Email 連結登入、沒有密碼：Supabase → Authentication → Users → 自己的帳號 → Send password recovery（或後台直接設定密碼）。
- 備份檔用 AES-256-GCM＋scrypt 加密；**備份密碼遺失就無法解開**，請另外記在安全的地方（例如密碼管理器）。
- 需要看明文時：`npm run backup -- --decrypt <檔案>` 產生 `.backup.json`（含病患姓名，用完刪除）。
- `backups/`、`*.ttbk`、`*.backup.json` 已被 `.gitignore` 排除，個資檢查也會擋下。

**還原**（資料遺失、重建專案時）：先在新專案執行 `supabase/schema.sql`，再
```bash
npm run restore -- <檔案>                                                        # 預覽筆數
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run restore -- <檔案> --yes        # 正式寫入
```
帳號無法從備份還原；之後照第 1 節重建帳號、設定角色並綁定技師。Secret key 用完到後台輪替。
