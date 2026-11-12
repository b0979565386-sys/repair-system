# 聚餐餐廳選項登記表

跨部門聚餐的候選餐廳清單（示範，資料全為虛構）。需求見 `需求筆記.txt`，專案規則見 `AGENTS.md`。

## 檔案

- `需求筆記.txt`：需求
- `聚餐餐廳欄位表.xlsx`：欄位表與範例資料
- `supabase/schema.sql`：Supabase 建表 SQL
- `index.html`、`style.css`、`app.js`、`config.js`：網頁清單（只能查看）
- `聚餐餐廳操作說明.docx`：給主辦人與同事的 Word 操作說明

## 設定

1. 在 Supabase 的 SQL Editor 執行 `supabase/schema.sql`。
2. 主辦人在 Supabase 後台的 Table Editor 新增或修改 `restaurant_options` 的資料。
3. `config.js` 只能放 publishable key；secret key 不可以寫進任何檔案。

## 本機預覽

在儲存庫根目錄執行：

```bash
python3 -m http.server 8000
```

再開啟 http://localhost:8000/聚餐餐廳登記/ 。

## 網址

儲存庫的 GitHub Pages 啟用後（`main` 分支、根目錄），網頁清單位於：

https://b0979565386-sys.github.io/repair-system/聚餐餐廳登記/
