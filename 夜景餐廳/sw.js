// 夜景餐廳 PWA 的 Service Worker。
// 只快取網頁本身的檔案（App Shell），讓 App 可以安裝、離線也能開啟畫面。
// 不快取任何 Supabase 資料：清單只在連線時讀取。
// 同一個網站上還有其他 App（報修登記、聚餐餐廳清單），所以只清除以「night-view-v」開頭的舊快取。
const PREFIX = "night-view-v";
const CACHE = PREFIX + "7";
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
// 來自 CDN 的程式庫（Supabase、Leaflet 地圖）。地圖圖磚不快取。
const LIBS = [
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js",
  "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js",
  "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    // 程式庫來自 CDN，快取失敗也不影響安裝
    for (const url of LIBS) {
      try { await cache.add(new Request(url, { mode: "cors" })); } catch (_) { /* 略過 */ }
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  // 只處理本站檔案與 CDN 程式庫；Supabase API、照片、景點搜尋、地圖圖磚一律直接連線、不快取
  if (!sameOrigin && !LIBS.includes(req.url)) return;
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
      const cached = await caches.match(req, { ignoreSearch: true, cacheName: CACHE });
      if (cached) return cached;
      if (req.mode === "navigate") {
        const shell = await caches.match(new URL("./index.html", self.registration.scope).href, { cacheName: CACHE });
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
