# 夜景餐廳口袋名單（PWA）

夜景餐廳清單（示範，資料全為虛構）。不用登入，打開就能用。

> **注意：** 不用登入代表任何拿到網址的人都能看到、修改、刪除整份清單。請只放可以公開的內容。需求見 `需求筆記.txt`，專案規則見 `AGENTS.md`。

## 檔案

- `index.html`、`style.css`、`app.js`、`config.js`：網頁（新增、修改、刪除、搜尋、篩選）
- `manifest.webmanifest`、`sw.js`、`icons/`：PWA 設定、Service Worker 與 App 圖示
- `supabase/schema.sql`：Supabase 建表 SQL（不用登入，任何人可讀寫）

## 設定（只需做一次）

1. 在 Supabase 的 SQL Editor 執行 `supabase/schema.sql`。
   - 如果之前執行過需要登入的舊版，直接再執行一次新版即可：會移除舊的擁有者欄位與政策，既有的餐廳資料會保留。
2. `config.js` 只能放 publishable key；secret key 不可以寫進任何檔案。
3. 需要備份時，在 Supabase 的 Table Editor 打開 `night_view_restaurants`，用 Export 匯出 CSV。

## 網址

儲存庫的 GitHub Pages 啟用後（`main` 分支、根目錄）：

https://b0979565386-sys.github.io/repair-system/夜景餐廳/

## 安裝到手機

- Android（Chrome）：開啟網址 → 右上角選單 →「安裝應用程式」，或按畫面上的「安裝 App」。
- iPhone（Safari）：開啟網址 → 分享按鈕 →「加入主畫面」。

離線時可以開啟 App 畫面，但清單需要連網才能讀取與修改。

## 本機預覽

在儲存庫根目錄執行：

```bash
python3 -m http.server 8000
```

再開啟 http://localhost:8000/夜景餐廳/ 。
