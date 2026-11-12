// Supabase 連線設定。
// publishable key 本來就是公開的，可以放在前端並上傳到 GitHub。
// 絕對不要把 secret 金鑰或 service_role 金鑰放在這裡。
window.APP_CONFIG = {
  // Supabase 專案網址，例如 https://abcdefghijklmnop.supabase.co
  supabaseUrl: "【你的 Supabase 專案網址】",
  // Supabase publishable key（以 sb_publishable_ 開頭）
  supabaseKey: "【你的 publishable key】",
};
