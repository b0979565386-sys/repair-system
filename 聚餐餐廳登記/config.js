// Supabase 連線設定。
// 只能放 publishable key（以 sb_publishable_ 開頭），它本來就是公開的。
// secret key、service_role 金鑰不可以寫進任何檔案。
// 這裡沿用報修登記系統的同一個 Supabase 專案；
// 請先在這個專案的 SQL Editor 執行 聚餐餐廳登記/supabase/schema.sql。
window.APP_CONFIG = {
  supabaseUrl: "https://dakxsdjcjlptpoblcepo.supabase.co",
  supabaseKey: "sb_publishable_kiGEGIuiHSCkz_iE1oKkEw_2SJiLSqV",
};
