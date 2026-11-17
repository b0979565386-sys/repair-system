// 午餐美食圖 PWA 的 Service Worker。
// 同一個網站（b0979565386-sys.github.io）上還有其他 App，所以：
// 1. 只處理下面列出的本 App 檔案，其他路徑（包含其他 App 的資料夾）一律不攔截。
// 2. 只清除以「lunch-v」開頭的舊快取，不會刪到其他 App 的快取。
// 不快取任何 Supabase 資料、登入資訊、地圖圖磚與搜尋結果：資料只在連線時讀取。
// 修改網頁檔案後，把 VERSION 加 1，已安裝的 App 才會更新。
const PREFIX = "lunch-v";
const VERSION = 3;
const CACHE = PREFIX + VERSION;
const SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./config.js",
  "./pwa.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./images/background.jpg",
];
const LIBS = [
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js",
  "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js",
  "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css",
];

const shellUrls = new Set(SHELL.map((p) => new URL(p, self.registration.scope).href));

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    for (const url of LIBS) {
      try { await cache.add(new Request(url, { mode: "cors" })); } catch (_) { /* 程式庫快取失敗不影響安裝 */ }
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
  url.search = "";
  url.hash = "";
  const mine = shellUrls.has(url.href) || LIBS.includes(req.url);
  if (!mine) return;

  // 先連網取得最新版本，失敗（離線）時改用快取
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
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
