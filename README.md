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
