# 夜景餐廳口袋名單（PWA）

夜景餐廳清單（示範，資料全為虛構）。不用登入，打開就能用。

> **注意：** 不用登入代表任何拿到網址的人都能看到、修改、刪除整份清單。請只放可以公開的內容。需求見 `需求筆記.txt`，專案規則見 `AGENTS.md`。

## 檔案

- `index.html`、`style.css`、`app.js`、`config.js`：網頁（搜尋景點、新增、修改、刪除、篩選）
- `manifest.webmanifest`、`sw.js`、`icons/`：PWA 設定、Service Worker 與 App 圖示
- `supabase/schema.sql`：Supabase 建表 SQL（不用登入，任何人可讀寫）

## 設定（只需做一次）

1. 在 Supabase 的 SQL Editor 執行 `supabase/schema.sql`。
   - 如果之前執行過需要登入的舊版，直接再執行一次新版即可：會移除舊的擁有者欄位與政策，既有的餐廳資料會保留。
2. `config.js` 只能放 publishable key；secret key 不可以寫進任何檔案。
3. 需要備份時，在 Supabase 的 Table Editor 打開 `night_view_restaurants`，用 Export 匯出 CSV。

## 搜尋景點

畫面上方的「搜尋景點」可以直接查詢真實地點（例如「象山」「台北 高空餐廳」）：

1. 輸入名稱後按「搜尋」，最多列出 8 個結果。
2. 按「在地圖查看 ↗」可以在地圖 App 開啟位置。
3. 按「加入清單」會開啟新增表單，自動帶入名稱、城市、地址與網址（有的話），補上夜景類型後儲存。

搜尋使用 OpenStreetMap 的 Nominatim 服務，不需要金鑰；輸入的關鍵字會送到 OpenStreetMap 的伺服器。找不到時試著加上城市名稱。

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
