// Supabase 連線設定。
// 只能放 publishable key（以 sb_publishable_ 開頭），它本來就是公開的。
// secret key、service_role 金鑰、帳號 Email 與密碼都不可以寫進任何檔案。
// 這裡沿用同一個 Supabase 專案；請先在這個專案的 SQL Editor 執行 夜景餐廳/supabase/schema.sql。
// 這一版不用登入：任何拿到網址的人都能讀取與修改清單。
window.APP_CONFIG = {
  supabaseUrl: "https://dakxsdjcjlptpoblcepo.supabase.co",
  supabaseKey: "sb_publishable_kiGEGIuiHSCkz_iE1oKkEw_2SJiLSqV",
};
