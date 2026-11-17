報修登記系統
提供報修資料新增與清單查閱，方便集中記錄與追蹤問題。
雲端任務測試
[報修欄位表（Excel）](文件/報修欄位表.xlsx)

## 網頁前端

根目錄的 `index.html`、`style.css`、`app.js`、`config.js` 是報修登記網頁（純 HTML/CSS/JavaScript，用 CDN 載入 supabase-js v2）。

1. 在 Supabase 的 SQL Editor 執行 `supabase/schema.sql`。
2. 在 `config.js` 填入 Supabase 專案網址與 publishable key。不要放 secret 金鑰。
3. 本機預覽：

   ```bash
   python3 -m http.server 8000
   ```

   再開啟 http://localhost:8000/ 。

4. 發佈：GitHub 儲存庫 Settings → Pages，來源選 `main` 分支的根目錄（`/ (root)`）。

## 安裝成 App（PWA）

報修登記可以安裝到手機主畫面：

- Android（Chrome）：開啟網址後按右上角的「安裝 App」，或從瀏覽器選單選「安裝應用程式」。
- iPhone（Safari）：開啟網址 → 分享按鈕 →「加入主畫面」。

相關檔案：`manifest.webmanifest`、`sw.js`、`pwa.js`、`icons/`。離線時可以開啟畫面，但送出與讀取清單需要連網。

同一個網站上還有 `聚餐餐廳登記/`、`夜景餐廳/` 兩個 App，各自有自己的 Service Worker 與快取：根目錄的 `sw.js` 只處理根目錄列出的檔案，也只清除以 `repair-v` 開頭的快取。修改網頁檔案後，把 `sw.js` 的 `VERSION` 加 1，已安裝的 App 才會更新。
