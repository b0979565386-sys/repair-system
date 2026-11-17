// Supabase 連線設定。
// 只能放 publishable key（以 sb_publishable_ 開頭），它本來就是公開的。
// secret key、service_role 金鑰、帳號 Email 與密碼都不可以寫進任何檔案。
// 沿用同一個 Supabase 專案；請先在 SQL Editor 執行 美食圖/supabase/schema.sql，
// 並在 Authentication 關閉自行註冊，由管理者建立同事帳號。
window.APP_CONFIG = {
  supabaseUrl: "https://dakxsdjcjlptpoblcepo.supabase.co",
  supabaseKey: "sb_publishable_kiGEGIuiHSCkz_iE1oKkEw_2SJiLSqV",
};
