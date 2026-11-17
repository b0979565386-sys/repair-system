// 夜景餐廳口袋名單（PWA，不用登入）
// 打開就能新增、修改、刪除、篩選夜景餐廳。
// 資料表與權限設計見 supabase/schema.sql：不用登入，任何拿到網址的人都能讀寫。
(function () {
  "use strict";

  const TABLE = "night_view_restaurants";
  const FIELDS = ["name", "city", "address", "url", "view_type", "floor_or_height", "window_seat",
    "price_range", "reservation", "opening_hours", "rating", "reason", "recommender", "visited_on", "latitude", "longitude"];
  const MAX_LEN = { name: 100, city: 50, address: 200, url: 500, floor_or_height: 50, opening_hours: 100, reason: 500, recommender: 50 };
  const LABELS = { name: "餐廳名稱", city: "城市或地區", address: "地址", url: "餐廳網址", floor_or_height: "樓層或高度", opening_hours: "營業時間", reason: "推薦理由", recommender: "推薦人" };

  // 照片：存在 Supabase Storage 的公開儲存桶，資料表只記檔名
  const BUCKET = "night-view-photos";
  const MAX_PHOTOS = 6;
  const MAX_SIDE = 1600;              // 長邊最多 1600 像素
  const MAX_BYTES = 2 * 1024 * 1024;  // 與儲存桶的 2 MB 上限一致

  // 只收臺灣的夜景餐廳：22 個縣市與地圖範圍（含澎湖、金門、馬祖），與資料庫 CHECK 一致
  const TW_CITIES = ["基隆市", "臺北市", "新北市", "桃園市", "新竹市", "新竹縣", "苗栗縣",
    "臺中市", "彰化縣", "南投縣", "雲林縣", "嘉義市", "嘉義縣", "臺南市",
    "高雄市", "屏東縣", "宜蘭縣", "花蓮縣", "臺東縣", "澎湖縣", "金門縣", "連江縣"];
  const TW_BOUNDS = { south: 21.8, north: 26.5, west: 118.0, east: 122.2 };
  const inTaiwan = (lat, lon) => lat >= TW_BOUNDS.south && lat <= TW_BOUNDS.north && lon >= TW_BOUNDS.west && lon <= TW_BOUNDS.east;
  // 「台」統一成正式寫法「臺」，再找出對應的縣市
  function toTwCity(text) {
    const t = String(text || "").replace(/台/g, "臺").trim();
    return TW_CITIES.find((c) => t === c || t.includes(c)) || "";
  }

  const $ = (id) => document.getElementById(id);
  const listEl = $("list");
  const listStatus = $("list-status");
  const editor = $("editor");
  const editorForm = $("editor-form");
  const editorMsg = $("editor-message");
  const filters = { search: $("f-search"), city: $("f-city"), view: $("f-view"), price: $("f-price"), status: $("f-status") };
  const dateFormat = new Intl.DateTimeFormat("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit" });

  let client = null;
  let rows = [];
  let editingId = null;

  // ---------- PWA：註冊 Service Worker 與安裝按鈕 ----------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch((err) => console.warn("Service Worker 註冊失敗", err));
    });
  }
  let installPrompt = null;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    $("install-btn").hidden = false;
  });
  $("install-btn").addEventListener("click", async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    $("install-btn").hidden = true;
  });
  window.addEventListener("appinstalled", () => { $("install-btn").hidden = true; });

  // ---------- 離線提示 ----------
  const updateOnline = () => { $("offline-banner").hidden = navigator.onLine; };
  window.addEventListener("online", () => { updateOnline(); if (client) load(); });
  window.addEventListener("offline", updateOnline);
  updateOnline();

  // ---------- 連線設定 ----------
  const cfg = window.APP_CONFIG || {};
  const problem = checkConfig(cfg);
  if (problem) {
    const box = $("config-warning");
    box.textContent = problem;
    box.hidden = false;
    $("add-btn").disabled = true;
    $("refresh-btn").disabled = true;
    listStatus.textContent = "尚未連線，無法載入清單。";
    return;
  }
  // 不用登入：不保存任何登入狀態
  client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  $("refresh-btn").addEventListener("click", load);
  load();

  // ---------- 讀取與顯示 ----------
  async function load() {
    listStatus.textContent = "載入中…";
    try {
      const { data, error } = await client
        .from(TABLE)
        .select("id, created_at, updated_at, photos, " + FIELDS.join(", "))
        .order("created_at", { ascending: false });
      if (error) throw error;
      rows = data || [];
      refreshCityOptions();
      render();
    } catch (err) {
      console.error(err);
      listEl.replaceChildren();
      listStatus.textContent = "清單載入失敗：" + describeError(err);
    }
  }

  function refreshCityOptions() {
    const cities = [...new Set(rows.map((r) => r.city))].sort((a, b) => a.localeCompare(b, "zh-Hant"));
    const keep = filters.city.value;
    filters.city.replaceChildren(new Option("全部縣市", ""), ...cities.map((c) => new Option(c, c)));
    filters.city.value = cities.includes(keep) ? keep : "";
  }

  for (const f of Object.values(filters)) f.addEventListener(f.tagName === "INPUT" ? "input" : "change", render);

  function render() {
    const q = filters.search.value.trim().toLowerCase();
    const shown = rows.filter((r) =>
      (!q || [r.name, r.city, r.address].some((v) => v && v.toLowerCase().includes(q))) &&
      (!filters.city.value || r.city === filters.city.value) &&
      (!filters.view.value || r.view_type === filters.view.value) &&
      (!filters.price.value || r.price_range === filters.price.value) &&
      (!filters.status.value || (filters.status.value === "visited") === !!r.visited_on)
    );
    listEl.replaceChildren(...shown.map(card));
    updateMap(shown);
    if (rows.length === 0) listStatus.textContent = "還沒有夜景餐廳，按右下角「＋」新增第一家。";
    else if (shown.length === 0) listStatus.textContent = "沒有符合條件的餐廳，試著放寬篩選條件。";
    else listStatus.textContent = shown.length === rows.length ? `共 ${rows.length} 家` : `符合條件 ${shown.length} 家（共 ${rows.length} 家）`;
  }

  function card(r) {
    // 一律用 textContent 放入資料內容，避免 XSS
    const li = el("li", "item");
    const photos = r.photos || [];
    if (photos.length) {
      const btn = el("button", "item-photo");
      btn.type = "button";
      btn.setAttribute("aria-label", `查看 ${r.name} 的照片（${photos.length} 張）`);
      const img = el("img");
      img.src = photoUrl(photos[0]);
      img.alt = "";
      img.loading = "lazy";
      btn.append(img);
      if (photos.length > 1) btn.append(el("span", "count", `${photos.length} 張`));
      btn.addEventListener("click", () => openViewer(r, 0));
      li.append(btn);
    }
    const head = el("div", "item-head");
    const title = el("div");
    title.append(el("h3", "", r.name), el("div", "city", r.city));
    head.append(title);
    if (r.rating) head.append(el("span", "stars", "★".repeat(r.rating) + "☆".repeat(5 - r.rating)));
    li.append(head);

    const chips = el("div", "chips");
    chips.append(el("span", "chip", r.view_type));
    if (r.price_range) chips.append(el("span", "chip", r.price_range));
    if (r.reservation) chips.append(el("span", "chip", "訂位：" + r.reservation));
    chips.append(r.visited_on ? el("span", "chip chip-visited", "去過 " + formatDate(r.visited_on)) : el("span", "chip chip-want", "想去"));
    li.append(chips);

    const facts = el("dl", "facts");
    if (r.address) addFact(facts, "地址", r.address);
    if (r.floor_or_height) addFact(facts, "樓層", r.floor_or_height);
    if (r.window_seat) addFact(facts, "靠窗座位", r.window_seat);
    if (r.opening_hours) addFact(facts, "營業時間", r.opening_hours);
    if (r.recommender) addFact(facts, "推薦人", r.recommender);
    if (facts.childElementCount) li.append(facts);
    if (r.reason) li.append(el("p", "reason", r.reason));

    const actions = el("div", "item-actions");
    const href = safeUrl(r.url);
    if (href) {
      const a = el("a", "", "餐廳網站 ↗");
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      actions.append(a);
    } else {
      actions.append(el("span"));
    }
    const btns = el("div", "item-btns");
    const view = el("button", "primary", "查看");
    view.type = "button";
    view.setAttribute("aria-label", "查看 " + r.name);
    view.addEventListener("click", () => openDetail(r.id));
    btns.append(view);
    if (hasPos(r) && HAS_MAP) {
      const onMap = el("button", "ghost", "地圖");
      onMap.type = "button";
      onMap.setAttribute("aria-label", "在地圖上看 " + r.name);
      onMap.addEventListener("click", () => showOnMap(r.id));
      btns.append(onMap);
    }
    const edit = el("button", "ghost", "修改");
    edit.type = "button";
    edit.setAttribute("aria-label", "修改 " + r.name);
    edit.addEventListener("click", () => openEditor(r));
    btns.append(edit);
    actions.append(btns);
    li.append(actions);
    return li;
  }

  // ---------- 地圖（Leaflet＋OpenStreetMap 圖磚，免金鑰） ----------
  // 圖磚依 OpenStreetMap 規範標示來源，不預先下載、不離線快取。
  const HAS_MAP = typeof window.L !== "undefined";
  const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> 貢獻者';
  const DEFAULT_CENTER = [23.7, 120.95]; // 預設顯示台灣全島
  const DEFAULT_ZOOM = 7;
  // 地圖只能在臺灣附近移動（四周多留一點空間）
  const MAP_OPTIONS = {
    zoomControl: true,
    minZoom: 6,
    maxBounds: [[TW_BOUNDS.south - 1, TW_BOUNDS.west - 1], [TW_BOUNDS.north + 1, TW_BOUNDS.east + 1]],
    maxBoundsViscosity: 0.8,
  };
  const mapView = $("map-view");
  const mapNote = $("map-note");
  let mainMap = null;
  let markerLayer = null;
  let myPosLayer = null;
  const markersById = new Map();
  let lastShown = [];
  let currentView = "list";

  function hasPos(r) {
    return r && r.latitude !== null && r.longitude !== null && isFinite(r.latitude) && isFinite(r.longitude);
  }

  function addTiles(map) {
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTR }).addTo(map);
  }

  $("view-list").addEventListener("click", () => setView("list"));
  $("view-map").addEventListener("click", () => setView("map"));

  function setView(view) {
    currentView = view;
    const isMap = view === "map";
    $("view-list").classList.toggle("active", !isMap);
    $("view-map").classList.toggle("active", isMap);
    $("view-list").setAttribute("aria-pressed", String(!isMap));
    $("view-map").setAttribute("aria-pressed", String(isMap));
    listEl.hidden = isMap;
    mapView.hidden = !isMap;
    if (!isMap) return;
    if (!HAS_MAP) {
      mapNote.textContent = "地圖載入失敗（可能是離線或網路問題），請連上網路後重新開啟。";
      return;
    }
    if (!mainMap) {
      mainMap = L.map("map", MAP_OPTIONS).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
      addTiles(mainMap);
      markerLayer = L.layerGroup().addTo(mainMap);
    }
    mainMap.invalidateSize();
    drawMarkers(true);
  }

  function updateMap(shown) {
    lastShown = shown;
    if (currentView === "map" && mainMap) drawMarkers(true);
  }

  function drawMarkers(fit) {
    markerLayer.clearLayers();
    markersById.clear();
    const withPos = lastShown.filter(hasPos);
    for (const r of withPos) {
      const marker = L.circleMarker([r.latitude, r.longitude], {
        radius: 12, weight: 3, color: "#1B1F3B",
        fillColor: r.visited_on ? "#8fd6a4" : "#f7d774", fillOpacity: 1,
      });
      // 點標記直接進入店家頁面；滑鼠移上去時顯示店名（用 DOM 元素，避免 XSS）
      marker.on("click", () => openDetail(r.id));
      marker.bindTooltip(el("span", "", r.name), { direction: "top", offset: [0, -10] });
      marker.addTo(markerLayer);
      markersById.set(r.id, marker);
    }
    const missing = lastShown.length - withPos.length;
    mapNote.textContent = (withPos.length ? `地圖上 ${withPos.length} 家（黃色＝想去、綠色＝去過），點標記看店家` : "目前沒有設定位置的餐廳")
      + (missing ? `；${missing} 家沒有位置，可在「修改」裡點地圖設定。` : "。");
    if (!fit) return;
    if (withPos.length === 1) mainMap.setView([withPos[0].latitude, withPos[0].longitude], 15);
    else if (withPos.length > 1) mainMap.fitBounds(L.latLngBounds(withPos.map((r) => [r.latitude, r.longitude])), { padding: [32, 32], maxZoom: 15 });
  }

  function showOnMap(id) {
    setView("map");
    const marker = markersById.get(id);
    if (!marker) return;
    mainMap.setView(marker.getLatLng(), 16);
    marker.openTooltip();
    window.scrollTo({ top: mapView.offsetTop - 70, behavior: "smooth" });
  }

  $("locate-btn").addEventListener("click", () => {
    if (!HAS_MAP || !mainMap) return;
    if (!("geolocation" in navigator)) { mapNote.textContent = "這個裝置不支援定位。"; return; }
    mapNote.textContent = "定位中…";
    navigator.geolocation.getCurrentPosition((pos) => {
      const here = [pos.coords.latitude, pos.coords.longitude];
      if (myPosLayer) myPosLayer.remove();
      myPosLayer = L.layerGroup([
        L.circle(here, { radius: Math.min(pos.coords.accuracy || 50, 500), color: "#7aa2f7", weight: 1, fillOpacity: 0.15 }),
        L.circleMarker(here, { radius: 7, color: "#ffffff", weight: 2, fillColor: "#3b82f6", fillOpacity: 1 }),
      ]).addTo(mainMap);
      mainMap.setView(here, 15);
      drawMarkers(false);
    }, () => {
      mapNote.textContent = "無法取得目前位置，請確認已允許定位。";
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  });

  // ---------- 表單裡的位置地圖 ----------
  let editMap = null;
  let editMarker = null;

  function initEditMap() {
    if (!HAS_MAP) {
      $("e-map").hidden = true;
      $("e-coords").textContent = "地圖載入失敗，暫時無法設定位置。";
      return;
    }
    if (editMap) return;
    editMap = L.map("e-map", MAP_OPTIONS).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    addTiles(editMap);
    editMap.on("click", (e) => {
      const lon = ((e.latlng.lng + 540) % 360) - 180;
      if (!inTaiwan(e.latlng.lat, lon)) {
        $("e-coords").textContent = "請點選臺灣範圍內的位置（含澎湖、金門、馬祖）。";
        return;
      }
      setPos(e.latlng.lat, e.latlng.lng);
    });
  }

  function round6(n) { return Math.round(n * 1e6) / 1e6; }

  function setPos(lat, lon) {
    lat = round6(lat);
    lon = round6(((lon + 540) % 360) - 180); // 地圖繞圈時把經度換回 -180～180
    $("e-lat").value = String(lat);
    $("e-lon").value = String(lon);
    if (editMarker) editMarker.setLatLng([lat, lon]);
    else editMarker = L.circleMarker([lat, lon], { radius: 9, weight: 2, color: "#1B1F3B", fillColor: "#f7d774", fillOpacity: 1 }).addTo(editMap);
    $("e-coords").textContent = "✓ 已設定位置（點地圖其他地方可以移動）";
    $("e-clear-pos").hidden = false;
  }

  function clearPos() {
    $("e-lat").value = "";
    $("e-lon").value = "";
    if (editMarker) { editMarker.remove(); editMarker = null; }
    if (HAS_MAP) $("e-coords").textContent = "尚未設定位置";
    $("e-clear-pos").hidden = true;
  }
  $("e-clear-pos").addEventListener("click", clearPos);

  // 開啟表單後，依表單內的座標放上或清除標記
  function syncEditMap() {
    initEditMap();
    if (!HAS_MAP) return;
    const lat = parseFloat($("e-lat").value);
    const lon = parseFloat($("e-lon").value);
    setTimeout(() => {
      editMap.invalidateSize();
      if (isFinite(lat) && isFinite(lon)) {
        setPos(lat, lon);
        editMap.setView([lat, lon], 16);
      } else {
        clearPos();
        const center = mainMap ? mainMap.getCenter() : null;
        editMap.setView(center || DEFAULT_CENTER, center ? mainMap.getZoom() : DEFAULT_ZOOM);
      }
    }, 50);
  }

  // ---------- 搜尋景點（OpenStreetMap Nominatim，免金鑰） ----------
  // 使用規範：只在按下搜尋時查詢（不做邊打邊搜）、每秒最多一次、標示 OpenStreetMap 來源。
  // 搜尋結果不存進資料庫，也不被 Service Worker 快取；按「加入清單」才會帶入新增表單。
  const PLACE_API = "https://nominatim.openstreetmap.org/search";
  const placeStatus = $("place-status");
  const placeResults = $("place-results");
  const placeCredit = $("place-credit");
  let lastPlaceSearch = 0;

  $("place-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const q = $("place-q").value.trim();
    if (!q) {
      showPlaceStatus("請輸入景點或餐廳名稱。");
      $("place-q").focus();
      return;
    }
    if (!navigator.onLine) return showPlaceStatus("目前離線，連上網路後才能搜尋景點。");
    const wait = 1000 - (Date.now() - lastPlaceSearch);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastPlaceSearch = Date.now();

    const btn = $("place-btn");
    btn.disabled = true;
    btn.textContent = "搜尋中…";
    showPlaceStatus("搜尋中…");
    placeResults.replaceChildren();
    try {
      const params = new URLSearchParams({
        q, format: "jsonv2", addressdetails: "1", extratags: "1", limit: "8", "accept-language": "zh-TW,zh,en",
        countrycodes: "tw", // 只搜尋臺灣
      });
      const res = await fetch(PLACE_API + "?" + params.toString(), { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      // 只保留臺灣範圍內的地點（以防服務回傳範圍外的結果）
      const places = (Array.isArray(data) ? data : []).map(toPlace)
        .filter((p) => p.name && p.latitude !== null && inTaiwan(p.latitude, p.longitude));
      placeResults.replaceChildren(...places.map(placeCard));
      placeCredit.hidden = false;
      showPlaceStatus(places.length ? `找到 ${places.length} 個地點，按「加入清單」帶入新增表單。` : "找不到符合的地點，試試加上城市名稱，例如「台北 象山」。");
    } catch (err) {
      console.error(err);
      placeCredit.hidden = true;
      showPlaceStatus(/HTTP 429/.test(String(err.message)) ? "搜尋太頻繁，請稍等一下再試。" : "景點搜尋失敗，請稍後再試。");
    } finally {
      btn.disabled = false;
      btn.textContent = "搜尋";
    }
  });

  $("place-clear").addEventListener("click", () => {
    placeResults.replaceChildren();
    placeCredit.hidden = true;
    placeStatus.hidden = true;
  });

  function showPlaceStatus(text) {
    placeStatus.textContent = text;
    placeStatus.hidden = false;
  }

  // 把搜尋結果整理成表單欄位，並裁成資料庫允許的長度
  function toPlace(p) {
    const a = p.address || {};
    const name = String(p.name || (p.display_name || "").split(",")[0] || "").trim();
    // 依序比對地址中的直轄市、縣、州與完整地址，找出臺灣的縣市；找不到就留空讓使用者選
    const city = [a.city, a.county, a.state, a.town, p.display_name].map(toTwCity).find(Boolean) || "";
    const parts = String(p.display_name || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length && name.includes(parts[0])) parts.shift();
    const website = p.extratags && (p.extratags.website || p.extratags["contact:website"]);
    return {
      name: clip(name, MAX_LEN.name),
      city: clip(city, MAX_LEN.city),
      address: clip(parts.join(", "), MAX_LEN.address),
      url: website && safeUrl(website) && !/\s/.test(website) && website.length <= MAX_LEN.url ? website : "",
      kind: placeKind(p),
      lat: p.lat,
      lon: p.lon,
      latitude: isFinite(parseFloat(p.lat)) ? round6(parseFloat(p.lat)) : null,
      longitude: isFinite(parseFloat(p.lon)) ? round6(parseFloat(p.lon)) : null,
    };
  }

  function placeKind(p) {
    const t = String(p.type || "");
    const c = String(p.category || p.class || "");
    const map = {
      restaurant: "餐廳", cafe: "咖啡廳", bar: "酒吧", pub: "酒吧", fast_food: "速食", food_court: "美食街",
      viewpoint: "觀景點", attraction: "景點", museum: "博物館", park: "公園", peak: "山峰", hotel: "飯店",
      city: "城市", town: "城鎮", suburb: "地區", station: "車站",
    };
    return map[t] || (c === "tourism" ? "景點" : c === "amenity" ? "設施" : "地點");
  }

  function placeCard(p) {
    const li = el("li", "place");
    li.append(el("span", "place-kind", p.kind), el("div", "place-name", p.name));
    if (p.address) li.append(el("div", "place-addr", p.address));
    const actions = el("div", "place-actions");
    if (p.name) {
      // 用店名＋地址查詢，Google 地圖會顯示店家名稱，而不是經緯度
      const a = el("a", "", "在地圖查看 ↗");
      a.href = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(mapsText(p.name, p.address, p.city));
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      actions.append(a);
    } else {
      actions.append(el("span"));
    }
    const add = el("button", "primary", "加入清單");
    add.type = "button";
    add.setAttribute("aria-label", "把 " + p.name + " 加入清單");
    add.addEventListener("click", () => openEditor(null, { name: p.name, city: p.city, address: p.address, url: p.url, latitude: p.latitude, longitude: p.longitude }));
    actions.append(add);
    li.append(actions);
    return li;
  }

  function clip(text, max) {
    const s = String(text || "").trim();
    return s.length > max ? s.slice(0, max).trim() : s;
  }

  // ---------- 縣市選單 ----------
  const citySelect = $("e-city");
  citySelect.append(...TW_CITIES.map((c) => new Option(c, c)));
  // 舊資料的城市若不是臺灣縣市（或寫法不同），暫時列出原本的值，提醒改選
  function setCityChoice(value) {
    citySelect.querySelectorAll("option[data-legacy]").forEach((o) => o.remove());
    if (value && !toTwCity(value)) {
      const legacy = new Option(`${value}（不是臺灣縣市，請改選）`, value);
      legacy.dataset.legacy = "1";
      citySelect.append(legacy);
    }
  }

  // ---------- 新增／修改／刪除 ----------
  $("add-btn").addEventListener("click", () => openEditor(null));
  editor.querySelector("[data-close]").addEventListener("click", () => editor.close());

  // row：要修改的資料；prefill：新增時預先帶入的欄位（例如搜尋景點的結果）
  function openEditor(row, prefill) {
    editingId = row ? row.id : null;
    $("editor-title").textContent = row ? "修改夜景餐廳" : "新增夜景餐廳";
    $("delete-btn").hidden = !row;
    editorMsg.hidden = true;
    editorForm.reset();
    const src = { ...(row || prefill || {}) };
    setCityChoice(src.city);
    if (src.city) src.city = toTwCity(src.city) || src.city;
    for (const f of FIELDS) {
      const input = editorForm.elements[f];
      if (input) input.value = src[f] !== null && src[f] !== undefined ? String(src[f]) : "";
    }
    // 照片：只有修改既有資料時才有已存的照片
    resetPhotoState((row && row.photos) || []);
    editor.showModal();
    syncEditMap();
    // 從搜尋帶入時，名稱已填好，直接跳到還沒填的必填欄位「夜景類型」
    (prefill && prefill.name ? $("e-view") : $("e-name")).focus();
  }

  editorForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    editorMsg.hidden = true;
    const record = collect();
    const invalid = validate(record);
    if (invalid) {
      showMsg(editorMsg, invalid.message);
      if (invalid.field) editorForm.elements[invalid.field].focus();
      else editorMsg.scrollIntoView({ block: "nearest" });
      return;
    }
    const btn = $("save-btn");
    btn.disabled = true;
    btn.textContent = "儲存中…";
    const uploaded = [];
    try {
      // 先上傳新照片，成功後才寫入資料表
      const fresh = editPhotos.filter((p) => p.isNew);
      for (let i = 0; i < fresh.length; i++) {
        btn.textContent = `上傳照片 ${i + 1}/${fresh.length}…`;
        const { error: upErr } = await client.storage.from(BUCKET).upload(fresh[i].name, fresh[i].blob, {
          contentType: "image/jpeg", cacheControl: "31536000", upsert: false,
        });
        if (upErr) throw Object.assign(upErr, { photo: true });
        uploaded.push(fresh[i].name);
      }
      btn.textContent = "儲存中…";
      record.photos = editPhotos.map((p) => p.name);
      // 只送內容欄位；id、時間欄位由資料庫產生
      const query = editingId
        ? client.from(TABLE).update(record).eq("id", editingId)
        : client.from(TABLE).insert(record);
      const { error } = await query;
      if (error) throw error;
      // 資料存好後，才刪除這次移除的舊照片
      if (removedPhotos.length) await removeStoredPhotos(removedPhotos);
      editor.close();
      await load();
    } catch (err) {
      console.error(err);
      // 資料沒存成功：把這次已上傳的照片刪掉，避免留下沒人用的檔案
      if (uploaded.length) await removeStoredPhotos(uploaded);
      showMsg(editorMsg, (err && err.photo ? "照片上傳失敗：" : "儲存失敗：") + describeError(err));
    } finally {
      btn.disabled = false;
      btn.textContent = "儲存";
    }
  });

  $("delete-btn").addEventListener("click", async () => {
    if (!editingId) return;
    const name = editorForm.elements.name.value.trim() || "這家餐廳";
    if (!window.confirm(`確定要刪除「${name}」嗎？刪除後無法復原。`)) return;
    try {
      const stored = editPhotos.filter((p) => !p.isNew).map((p) => p.name).concat(removedPhotos);
      const { error } = await client.from(TABLE).delete().eq("id", editingId);
      if (error) throw error;
      if (stored.length) await removeStoredPhotos(stored);
      editor.close();
      await load();
    } catch (err) {
      console.error(err);
      showMsg(editorMsg, "刪除失敗：" + describeError(err));
    }
  });

  function collect() {
    const record = {};
    for (const f of FIELDS) {
      const raw = String(editorForm.elements[f].value || "").trim();
      record[f] = raw === "" ? null : raw;
    }
    record.rating = record.rating ? parseInt(record.rating, 10) : null;
    record.latitude = record.latitude === null ? null : Number(record.latitude);
    record.longitude = record.longitude === null ? null : Number(record.longitude);
    return record;
  }

  function validate(r) {
    if (!r.name) return { field: "name", message: "請填寫餐廳名稱。" };
    if (!r.city) return { field: "city", message: "請選擇縣市。" };
    if (!TW_CITIES.includes(r.city)) return { field: "city", message: "只能選臺灣的縣市，請重新選擇。" };
    if (!r.view_type) return { field: "view_type", message: "請選擇夜景類型。" };
    for (const [f, max] of Object.entries(MAX_LEN)) {
      if (r[f] && r[f].length > max) return { field: f, message: `${LABELS[f]}最多 ${max} 字。` };
    }
    if (r.url && (!safeUrl(r.url) || /\s/.test(r.url))) return { field: "url", message: "餐廳網址必須以 http:// 或 https:// 開頭。" };
    const hasLat = r.latitude !== null, hasLon = r.longitude !== null;
    if (hasLat !== hasLon || (hasLat && !(Math.abs(r.latitude) <= 90 && Math.abs(r.longitude) <= 180))) {
      return { field: null, message: "位置資料不正確，請在地圖上重新點選，或按「清除位置」。" };
    }
    if (hasLat && !inTaiwan(r.latitude, r.longitude)) {
      return { field: null, message: "位置不在臺灣範圍內，請在地圖上重新點選臺灣的位置，或按「清除位置」。" };
    }
    return null;
  }

  // ---------- 店家頁面 ----------
  // 從地圖標記或清單「查看」進入；畫面上不顯示經緯度
  const detail = $("detail");
  let detailId = null;
  $("detail-close").addEventListener("click", () => detail.close());

  function openDetail(id) {
    const r = rows.find((x) => x.id === id);
    if (!r) return;
    detailId = id;
    $("detail-name").textContent = r.name;
    const body = $("detail-body");
    const parts = [];

    const photos = r.photos || [];
    if (photos.length) {
      const strip = el("div", "detail-photos");
      photos.forEach((name, i) => {
        const b = el("button", "detail-photo");
        b.type = "button";
        b.setAttribute("aria-label", `放大第 ${i + 1} 張照片`);
        const img = el("img");
        img.src = photoUrl(name);
        img.alt = `${r.name} 照片 ${i + 1}`;
        img.loading = "lazy";
        b.append(img);
        b.addEventListener("click", () => openViewer(r, i));
        strip.append(b);
      });
      parts.push(strip);
    }

    const head = el("div", "detail-head");
    head.append(el("div", "city", r.city));
    if (r.rating) head.append(el("span", "stars", "★".repeat(r.rating) + "☆".repeat(5 - r.rating)));
    parts.push(head);

    const chips = el("div", "chips");
    chips.append(el("span", "chip", r.view_type));
    if (r.price_range) chips.append(el("span", "chip", r.price_range));
    if (r.reservation) chips.append(el("span", "chip", "訂位：" + r.reservation));
    chips.append(r.visited_on ? el("span", "chip chip-visited", "去過 " + formatDate(r.visited_on)) : el("span", "chip chip-want", "想去"));
    parts.push(chips);

    const facts = el("dl", "facts");
    if (r.address) addFact(facts, "地址", r.address);
    if (r.floor_or_height) addFact(facts, "樓層", r.floor_or_height);
    if (r.window_seat) addFact(facts, "靠窗座位", r.window_seat);
    if (r.opening_hours) addFact(facts, "營業時間", r.opening_hours);
    if (r.recommender) addFact(facts, "推薦人", r.recommender);
    addFact(facts, "加入日期", formatDate(String(r.created_at || "").slice(0, 10)));
    parts.push(facts);
    if (r.reason) parts.push(el("p", "reason", r.reason));

    const links = el("div", "detail-links");
    {
      // 用店名＋地址導航，Google 地圖會顯示店家名稱，而不是經緯度
      const nav = el("a", "link-btn", "導航 ↗");
      nav.href = "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(mapsText(r.name, r.address, r.city));
      nav.target = "_blank";
      nav.rel = "noopener noreferrer";
      links.append(nav);
    }
    const href = safeUrl(r.url);
    if (href) {
      const site = el("a", "link-btn", "餐廳網站 ↗");
      site.href = href;
      site.target = "_blank";
      site.rel = "noopener noreferrer";
      links.append(site);
    }
    if (hasPos(r) && HAS_MAP && currentView !== "map") {
      const onMap = el("button", "ghost", "在地圖上看");
      onMap.type = "button";
      onMap.addEventListener("click", () => { detail.close(); showOnMap(r.id); });
      links.append(onMap);
    }
    if (!hasPos(r)) links.append(el("span", "muted small", "還沒有設定位置，可在「修改」裡點地圖設定。"));
    parts.push(links);

    body.replaceChildren(...parts);
    if (!detail.open) detail.showModal();
    body.scrollTop = 0;
  }

  $("detail-edit").addEventListener("click", () => {
    const r = rows.find((x) => x.id === detailId);
    detail.close();
    if (r) openEditor(r);
  });

  // ---------- 照片 ----------
  let editPhotos = [];     // 表單中目前的照片：{ name, url, isNew, blob }
  let removedPhotos = [];  // 這次在表單中移除的「已存」照片檔名
  const photoInput = $("e-photo-input");
  const photoMsg = $("e-photo-msg");

  function photoUrl(name) {
    return client.storage.from(BUCKET).getPublicUrl(name).data.publicUrl;
  }

  function resetPhotoState(names) {
    releasePreviews();
    editPhotos = names.map((name) => ({ name, url: photoUrl(name), isNew: false }));
    removedPhotos = [];
    photoMsg.hidden = true;
    renderPhotos();
  }

  function releasePreviews() {
    for (const p of editPhotos) if (p.isNew) URL.revokeObjectURL(p.url);
  }
  editor.addEventListener("close", releasePreviews);

  function renderPhotos() {
    const grid = $("e-photos");
    grid.replaceChildren(...editPhotos.map((p, i) => {
      const li = el("li");
      const img = el("img");
      img.src = p.url;
      img.alt = `照片 ${i + 1}`;
      li.append(img);
      if (p.isNew) li.append(el("span", "photo-new", "新"));
      const del = el("button", "photo-remove", "×");
      del.type = "button";
      del.setAttribute("aria-label", `移除照片 ${i + 1}`);
      del.addEventListener("click", () => removePhoto(i));
      li.append(del);
      return li;
    }));
    const full = editPhotos.length >= MAX_PHOTOS;
    $("e-photo-add").classList.toggle("disabled", full);
    photoInput.disabled = full;
    $("e-photo-add").querySelector("span").textContent = full ? `已達 ${MAX_PHOTOS} 張上限` : `＋ 加入照片（${editPhotos.length}/${MAX_PHOTOS}）`;
  }

  function removePhoto(i) {
    const [p] = editPhotos.splice(i, 1);
    if (p.isNew) URL.revokeObjectURL(p.url);
    else removedPhotos.push(p.name);
    renderPhotos();
  }

  photoInput.addEventListener("change", async () => {
    const files = [...photoInput.files];
    photoInput.value = "";
    if (!files.length) return;
    const room = MAX_PHOTOS - editPhotos.length;
    const take = files.slice(0, room);
    const notes = [];
    if (files.length > room) notes.push(`最多 ${MAX_PHOTOS} 張，只加入前 ${room} 張。`);
    showPhotoMsg("處理照片中…");
    for (const file of take) {
      try {
        const blob = await toJpeg(file);
        editPhotos.push({ name: newPhotoName(), blob, url: URL.createObjectURL(blob), isNew: true });
        renderPhotos();
      } catch (err) {
        console.error(err);
        notes.push(`「${file.name}」無法加入：${err.message}`);
      }
    }
    if (notes.length) showPhotoMsg(notes.join(" "));
    else photoMsg.hidden = true;
  });

  function showPhotoMsg(text) {
    photoMsg.textContent = text;
    photoMsg.hidden = false;
  }

  // 縮小並重新存成 JPEG：長邊最多 1600 像素、不超過 2 MB。
  // 重新繪製會去掉照片裡的 EXIF（含拍攝定位）資訊。
  async function toJpeg(file) {
    if (!/^image\//.test(file.type || "")) throw new Error("不是圖片檔。");
    let source;
    try {
      source = await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch (_) {
      source = await loadImage(file);
    }
    const w = source.width, h = source.height;
    if (!w || !h) throw new Error("無法讀取這張照片的格式。");
    const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height); // 透明背景改成黑色
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    if (source.close) source.close();
    for (const q of [0.82, 0.72, 0.62, 0.5]) {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", q));
      if (blob && blob.size <= MAX_BYTES) return blob;
    }
    throw new Error("照片太大，壓縮後仍超過 2 MB。");
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("無法讀取這張照片的格式。")); };
      img.src = url;
    });
  }

  function newPhotoName() {
    let id;
    if (window.crypto && crypto.randomUUID) id = crypto.randomUUID();
    else {
      const b = crypto.getRandomValues(new Uint8Array(16));
      b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
      const hex = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
      id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    return id.toLowerCase() + ".jpg";
  }

  async function removeStoredPhotos(names) {
    try {
      const { error } = await client.storage.from(BUCKET).remove(names);
      if (error) throw error;
    } catch (err) {
      // 刪不掉不影響資料，只會在儲存桶留下沒用到的檔案
      console.warn("照片刪除失敗", err);
    }
  }

  // 全螢幕檢視：左右滑動切換照片
  const viewer = $("viewer");
  $("viewer-close").addEventListener("click", () => viewer.close());
  function openViewer(r, index) {
    const strip = $("viewer-strip");
    const photos = r.photos || [];
    $("viewer-title").textContent = `${r.name}（${photos.length} 張）`;
    strip.replaceChildren(...photos.map((name, i) => {
      const img = el("img");
      img.src = photoUrl(name);
      img.alt = `${r.name} 照片 ${i + 1}`;
      img.loading = "lazy";
      return img;
    }));
    viewer.showModal();
    strip.scrollLeft = strip.clientWidth * index;
  }

  // ---------- 匯出（在瀏覽器產生檔案，不經過伺服器） ----------
  const exporter = $("exporter");
  const exportForm = $("export-form");
  const exportMsg = $("export-msg");
  const EXPORT_COLUMNS = [
    ["餐廳名稱", (r) => r.name],
    ["城市或地區", (r) => r.city],
    ["地址", (r) => r.address],
    ["餐廳網址", (r) => r.url],
    ["夜景類型", (r) => r.view_type],
    ["樓層或高度", (r) => r.floor_or_height],
    ["靠窗座位", (r) => r.window_seat],
    ["每人價位", (r) => r.price_range],
    ["是否需要訂位", (r) => r.reservation],
    ["營業時間", (r) => r.opening_hours],
    ["評分", (r) => r.rating],
    ["推薦理由", (r) => r.reason],
    ["推薦人", (r) => r.recommender],
    ["狀態", (r) => (r.visited_on ? "去過" : "想去")],
    ["去過的日期", (r) => r.visited_on],
    ["緯度", (r) => r.latitude],
    ["經度", (r) => r.longitude],
    ["照片數", (r) => (r.photos || []).length],
    ["照片網址", (r) => (r.photos || []).map(photoUrl).join("\n")],
    ["登記時間", (r) => formatDateTime(r.created_at)],
    ["最後修改時間", (r) => formatDateTime(r.updated_at)],
  ];

  $("export-btn").addEventListener("click", () => {
    const shownCount = lastShown.length, allCount = rows.length;
    $("export-shown-label").textContent = `目前篩選結果（${shownCount} 家）`;
    $("export-all-label").textContent = `全部（${allCount} 家）`;
    const filtered = shownCount !== allCount;
    exportForm.elements.scope.value = filtered ? "shown" : "all";
    exportMsg.hidden = true;
    exporter.showModal();
  });
  $("export-cancel").addEventListener("click", () => exporter.close());

  exportForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const list = exportForm.elements.scope.value === "all" ? rows : lastShown;
    if (!list.length) return showMsg(exportMsg, "沒有可以匯出的餐廳。");
    const format = exportForm.elements.format.value;
    // 檔名用英文：部分瀏覽器遇到中文檔名會改成「download」
    const stamp = fileStamp(new Date());
    try {
      if (format === "json") {
        const data = {
          app: "夜景餐廳口袋名單",
          exported_at: new Date().toISOString(),
          count: list.length,
          restaurants: list.map((r) => ({ ...r, photo_urls: (r.photos || []).map(photoUrl) })),
        };
        download(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), `night-view_${stamp}.json`);
      } else {
        download(new Blob(["\uFEFF" + toCsv(list)], { type: "text/csv;charset=utf-8" }), `night-view_${stamp}.csv`);
      }
      exporter.close();
    } catch (err) {
      console.error(err);
      showMsg(exportMsg, "匯出失敗，請再試一次。");
    }
  });

  // CSV：UTF-8 加 BOM，Excel 才能正確顯示中文；每格依 RFC 4180 加引號。
  // 清單任何人都能編輯，所以以 = + - @ 等開頭的內容前面加 ' ，避免 Excel 當成公式執行。
  function toCsv(list) {
    const cell = (v) => {
      let t = v === null || v === undefined ? "" : String(v);
      if (typeof v === "string" && /^[=+\-@\t\r]/.test(t)) t = "'" + t;
      return '"' + t.replace(/"/g, '""') + '"';
    };
    const lines = [EXPORT_COLUMNS.map(([h]) => cell(h)).join(",")];
    for (const r of list) lines.push(EXPORT_COLUMNS.map(([, get]) => cell(get(r))).join(","));
    return lines.join("\r\n") + "\r\n";
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function fileStamp(d) {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
  }

  function formatDateTime(value) {
    if (!value) return "";
    const d = new Date(value);
    if (isNaN(d)) return String(value);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // ---------- 小工具 ----------
  // Google 地圖用的文字：店名＋地址（沒有地址就用縣市），不放經緯度
  function mapsText(name, address, city) {
    const where = address || city || "";
    return [name, where && !String(name).includes(where) ? where : ""].filter(Boolean).join(" ");
  }
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }
  function addFact(dl, label, value) { dl.append(el("dt", "", label), el("dd", "", value)); }
  function formatDate(value) {
    const d = new Date(value + "T00:00:00");
    return isNaN(d) ? value : dateFormat.format(d);
  }
  function showMsg(box, text) { box.textContent = text; box.hidden = false; }
  function safeUrl(value) {
    if (!value) return null;
    try {
      const u = new URL(value);
      return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
    } catch (_) { return null; }
  }
  function describeError(err) {
    if (!navigator.onLine) return "目前離線，請連上網路後再試。";
    const code = err && err.code;
    if (code === "42501") return "沒有權限，請重新執行 supabase/schema.sql 更新資料庫設定。";
    if (code === "23514") return "資料格式不符合規定，請檢查各欄位內容與字數。";
    if (code === "42P01" || code === "PGRST205") return "找不到資料表，請先執行 supabase/schema.sql。";
    const msg = String((err && err.message) || "");
    if (/bucket not found/i.test(msg)) return "找不到照片儲存空間，請先執行 supabase/schema.sql。";
    if (/row-level security|unauthorized/i.test(msg)) return "沒有權限上傳照片，請重新執行 supabase/schema.sql。";
    if (/maximum allowed size|too large/i.test(msg)) return "照片太大（每張最多 2 MB）。";
    if (/mime type/i.test(msg)) return "只接受 JPEG 照片。";
    if (/already exists|duplicate/i.test(msg)) return "照片檔名重複，請再試一次。";
    if (err && /fetch|network/i.test(String(err.message))) return "無法連線到伺服器，請稍後再試。";
    return (err && err.message) || "發生未知錯誤，請稍後再試。";
  }
  function checkConfig(c) {
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      return "無法載入 Supabase 程式庫，請連上網路後重新開啟。";
    }
    const url = String(c.supabaseUrl || "");
    const key = String(c.supabaseKey || "");
    if (!/^https:\/\/\S+$/.test(url) || !key) return "尚未設定 Supabase 連線：請在 config.js 填入專案網址與 publishable key。";
    if (!/^sb_publishable_/.test(key)) return "config.js 只能放 publishable key（sb_publishable_ 開頭），請立刻移除其他金鑰。";
    return null;
  }
})();
