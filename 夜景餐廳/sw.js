// 夜景餐廳 PWA 的 Service Worker。
// 只快取網頁本身的檔案（App Shell），讓 App 可以安裝、離線也能開啟畫面。
// 不快取任何 Supabase 資料：清單是個人資料，只在登入且連線時讀取。
const CACHE = "night-view-v1";
const SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./config.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];
const LIB = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js";

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    // 程式庫來自 CDN，快取失敗也不影響安裝
    try { await cache.add(new Request(LIB, { mode: "cors" })); } catch (_) { /* 略過 */ }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  // 只處理本站檔案與 supabase-js 程式庫；Supabase API 一律直接連線、不快取
  if (!sameOrigin && req.url !== LIB) return;
  if (sameOrigin && !url.pathname.startsWith(new URL("./", self.location).pathname)) return;

  // 先連網取得最新版本，失敗（離線）時改用快取
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok) {
        const cache = await caches.open(CACHE);
        cache.put(req, res.clone());
      }
      return res;
    } catch (err) {
      const cached = await caches.match(req, { ignoreSearch: true });
      if (cached) return cached;
      if (req.mode === "navigate") {
        const shell = await caches.match("./index.html");
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
