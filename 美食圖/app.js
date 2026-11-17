// 公司附近午餐美食圖（PWA）
// 登入後：在地圖與清單查看店家、篩選、新增店家、評分（一人一家店一筆）。
// 資料表與權限設計見 supabase/schema.sql：未登入什麼都看不到；新增者／評分者由資料庫自動帶入本人。
// 需求筆記「待確認」的部分採最保守做法：同事不能修改或刪除店家與評價（由管理者在後台處理）。
(function () {
  "use strict";

  const T = { profiles: "lunch_profiles", restaurants: "lunch_restaurants", ratings: "lunch_ratings" };
  const REST_FIELDS = ["name", "address", "latitude", "longitude", "walk_minutes", "cuisine", "price_range",
    "signature_dishes", "opening_hours", "dining_mode", "delivery"];
  const CUISINES = ["便當", "麵食", "飯類", "輕食", "異國料理", "其他"];
  const MAX_LEN = { name: 100, address: 200, signature_dishes: 200, opening_hours: 100 };
  const LABELS = { name: "店名", address: "地址", signature_dishes: "推薦菜色", opening_hours: "營業時間" };
  const DEFAULT_CENTER = [23.7, 120.95]; // 公司位置待確認，先顯示臺灣全島，有店家後自動縮放
  const DEFAULT_ZOOM = 7;
  const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> 貢獻者';
  const PLACE_API = "https://nominatim.openstreetmap.org/search";

  const $ = (id) => document.getElementById(id);
  const views = { login: $("login-view"), app: $("app-view") };
  const listEl = $("list");
  const listStatus = $("list-status");
  const filters = { search: $("f-search"), cuisine: $("f-cuisine"), price: $("f-price"), walk: $("f-walk"), sort: $("f-sort"), delivery: $("f-delivery"), unrated: $("f-unrated") };
  const dateFormat = new Intl.DateTimeFormat("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit" });
  const HAS_MAP = typeof window.L !== "undefined";

  let client = null;
  let me = null;               // 目前登入的帳號 id
  let myNickname = "";
  let restaurants = [];
  let ratingsBy = new Map();   // restaurant_id -> [評價]
  let nicknames = new Map();   // user id -> 暱稱
  let shown = [];
  let currentView = "map";

  // ---------- 連線設定 ----------
  const cfg = window.APP_CONFIG || {};
  const problem = checkConfig(cfg);
  if (problem) {
    const box = $("config-warning");
    box.textContent = problem;
    box.hidden = false;
    views.login.hidden = false;
    $("login-btn").disabled = true;
    return;
  }
  // 登入狀態存在這台裝置；用專屬的名稱，避免和同網站的其他 App 混在一起
  client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: "lunch-map-auth" },
  });

  // ---------- 登入與登出 ----------
  let shownUser;
  client.auth.onAuthStateChange((_e, session) => showView(session));
  client.auth.getSession().then(({ data }) => showView(data.session));

  async function showView(session) {
    const userId = session ? session.user.id : null;
    if (userId === shownUser) return;
    shownUser = userId;
    me = userId;
    views.login.hidden = !!session;
    views.app.hidden = !session;
    if (!session) {
      restaurants = []; ratingsBy = new Map(); nicknames = new Map(); myNickname = "";
      listEl.replaceChildren();
      if (markerLayer) markerLayer.clearLayers();
      $("login-password").value = "";
      return;
    }
    setView(currentView);
    await loadAll();
    if (!myNickname) openNickname(true);
  }

  $("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const msg = $("login-message");
    msg.hidden = true;
    const email = $("login-email").value.trim();
    const password = $("login-password").value;
    if (!email || !password) return showMsg(msg, "請輸入 Email 與密碼。");
    const btn = $("login-btn");
    btn.disabled = true;
    btn.textContent = "登入中…";
    try {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } catch (err) {
      console.error(err);
      showMsg(msg, describeAuthError(err));
    } finally {
      btn.disabled = false;
      btn.textContent = "登入";
    }
  });

  $("logout-btn").addEventListener("click", () => client.auth.signOut());

  // ---------- 暱稱 ----------
  const nickDialog = $("nickname-dialog");
  $("nickname-btn").addEventListener("click", () => openNickname(false));
  $("nickname-cancel").addEventListener("click", () => nickDialog.close());
  let nickRequired = false;
  nickDialog.addEventListener("cancel", (e) => { if (nickRequired) e.preventDefault(); }); // 第一次一定要設定

  function openNickname(required) {
    nickRequired = required;
    $("nickname-cancel").hidden = required;
    $("nickname-input").value = myNickname;
    $("nickname-message").hidden = true;
    nickDialog.showModal();
    $("nickname-input").focus();
  }

  $("nickname-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const nickname = $("nickname-input").value.trim();
    const msg = $("nickname-message");
    if (!nickname) return showMsg(msg, "請輸入暱稱。");
    if (nickname.length > 20) return showMsg(msg, "暱稱最多 20 字。");
    if (/@/.test(nickname)) return showMsg(msg, "暱稱請不要使用 Email。");
    const btn = $("nickname-save");
    btn.disabled = true;
    try {
      const { error } = myNickname
        ? await client.from(T.profiles).update({ nickname }).eq("id", me)
        : await client.from(T.profiles).insert({ nickname });
      if (error) throw error;
      myNickname = nickname;
      nicknames.set(me, nickname);
      $("nickname-btn").textContent = nickname;
      nickRequired = false;
      nickDialog.close();
      render();
    } catch (err) {
      console.error(err);
      showMsg(msg, "暱稱儲存失敗：" + describeError(err));
    } finally {
      btn.disabled = false;
    }
  });

  // ---------- 讀取資料 ----------
  async function loadAll() {
    listStatus.textContent = "載入中…";
    try {
      const [r1, r2, r3] = await Promise.all([
        client.from(T.restaurants).select("id, created_by, created_at, " + REST_FIELDS.join(", ")).order("created_at", { ascending: false }),
        client.from(T.ratings).select("id, restaurant_id, user_id, score, comment, created_at").order("created_at", { ascending: false }),
        client.from(T.profiles).select("id, nickname"),
      ]);
      for (const r of [r1, r2, r3]) if (r.error) throw r.error;
      restaurants = r1.data || [];
      ratingsBy = new Map();
      for (const rt of r2.data || []) {
        if (!ratingsBy.has(rt.restaurant_id)) ratingsBy.set(rt.restaurant_id, []);
        ratingsBy.get(rt.restaurant_id).push(rt);
      }
      nicknames = new Map((r3.data || []).map((p) => [p.id, p.nickname]));
      myNickname = nicknames.get(me) || "";
      $("nickname-btn").textContent = myNickname || "設定暱稱";
      render();
    } catch (err) {
      console.error(err);
      listEl.replaceChildren();
      if (markerLayer) markerLayer.clearLayers();
      listStatus.textContent = "資料載入失敗：" + describeError(err);
    }
  }
  window.addEventListener("online", () => { if (me) loadAll(); });

  function stats(id) {
    const list = ratingsBy.get(id) || [];
    const avg = list.length ? list.reduce((s, r) => s + r.score, 0) / list.length : null;
    return { list, count: list.length, avg, mine: list.find((r) => r.user_id === me) || null };
  }

  // ---------- 篩選、排序、顯示 ----------
  for (const f of Object.values(filters)) f.addEventListener(f.type === "search" ? "input" : "change", render);

  function render() {
    const q = filters.search.value.trim().toLowerCase();
    const maxWalk = parseInt(filters.walk.value, 10);
    shown = restaurants.filter((r) =>
      (!q || [r.name, r.address, r.signature_dishes].some((v) => v && v.toLowerCase().includes(q))) &&
      (!filters.cuisine.value || r.cuisine === filters.cuisine.value) &&
      (!filters.price.value || r.price_range === filters.price.value) &&
      (!(maxWalk > 0) || (r.walk_minutes !== null && r.walk_minutes <= maxWalk)) &&
      (!filters.delivery.checked || r.delivery === true) &&
      (!filters.unrated.checked || !stats(r.id).mine)
    );
    const sort = filters.sort.value;
    if (sort === "rating") shown.sort((a, b) => (stats(b.id).avg ?? -1) - (stats(a.id).avg ?? -1) || stats(b.id).count - stats(a.id).count);
    else if (sort === "walk") shown.sort((a, b) => (a.walk_minutes ?? 999) - (b.walk_minutes ?? 999));
    // new：維持資料庫回傳的新到舊

    listEl.replaceChildren(...shown.map(card));
    drawMarkers();
    if (restaurants.length === 0) listStatus.textContent = "還沒有店家，按右下角「＋」新增第一家。";
    else if (shown.length === 0) listStatus.textContent = "沒有符合條件的店家，試著放寬篩選條件。";
    else listStatus.textContent = shown.length === restaurants.length ? `共 ${shown.length} 家` : `符合條件 ${shown.length} 家（共 ${restaurants.length} 家）`;
  }

  function scoreText(s) {
    return s.count ? `★ ${s.avg.toFixed(1)}` : "尚無評分";
  }

  function card(r) {
    // 一律用 textContent 放入資料內容，避免 XSS
    const s = stats(r.id);
    const li = el("li", "item");
    const head = el("div", "item-head");
    head.append(el("h3", "", r.name));
    const score = el("span", "score", scoreText(s));
    if (s.count) score.append(el("small", "", `（${s.count} 人）`));
    head.append(score);
    li.append(head, chipsFor(r, s));

    const facts = el("dl", "facts");
    if (r.walk_minutes) addFact(facts, "步行", `${r.walk_minutes} 分鐘`);
    if (r.address) addFact(facts, "地址", r.address);
    if (r.signature_dishes) addFact(facts, "推薦", r.signature_dishes);
    if (r.opening_hours) addFact(facts, "營業", r.opening_hours);
    addFact(facts, "新增者", nameOf(r.created_by));
    li.append(facts);

    const actions = el("div", "item-actions");
    actions.append(navLink(r));
    const btns = el("div", "btns");
    if (HAS_MAP) btns.append(button("地圖", "ghost", () => showOnMap(r.id), "在地圖上看 " + r.name));
    btns.append(button(s.mine ? "看評價" : "評分", s.mine ? "ghost" : "primary", () => openDetail(r.id), (s.mine ? "看評價 " : "評分 ") + r.name));
    actions.append(btns);
    li.append(actions);
    return li;
  }

  function chipsFor(r, s) {
    const chips = el("div", "chips");
    chips.append(el("span", "chip", r.cuisine));
    if (r.price_range) chips.append(el("span", "chip", r.price_range));
    if (r.dining_mode) chips.append(el("span", "chip", r.dining_mode));
    if (r.delivery === true) chips.append(el("span", "chip chip-ok", "可外送"));
    if (s.mine) chips.append(el("span", "chip chip-ok", `我評了 ${s.mine.score} 分`));
    return chips;
  }

  function navLink(r) {
    const a = el("a", "", "導航 ↗");
    a.href = `https://www.google.com/maps/dir/?api=1&destination=${r.latitude},${r.longitude}&travelmode=walking`;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    return a;
  }

  function nameOf(userId) {
    if (!userId) return "（已刪除的帳號）";
    return nicknames.get(userId) || "（未設定暱稱）";
  }

  // ---------- 地圖／清單切換 ----------
  $("view-map").addEventListener("click", () => setView("map"));
  $("view-list").addEventListener("click", () => setView("list"));

  function setView(view) {
    currentView = view;
    const isMap = view === "map";
    $("view-map").classList.toggle("active", isMap);
    $("view-list").classList.toggle("active", !isMap);
    $("view-map").setAttribute("aria-pressed", String(isMap));
    $("view-list").setAttribute("aria-pressed", String(!isMap));
    $("map-view").hidden = !isMap;
    listEl.hidden = isMap;
    if (isMap) ensureMap();
  }

  // ---------- 地圖（Leaflet＋OpenStreetMap，免金鑰） ----------
  let mainMap = null;
  let markerLayer = null;
  let myPosLayer = null;
  const markersById = new Map();
  let fitted = false;

  function addTiles(map) { L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTR }).addTo(map); }

  function ensureMap() {
    if (!HAS_MAP) {
      $("map-note").textContent = "地圖載入失敗（可能是離線或網路問題），請改用「清單」或連網後重新開啟。";
      return;
    }
    if (!mainMap) {
      mainMap = L.map("map", { zoomControl: true }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
      addTiles(mainMap);
      markerLayer = L.layerGroup().addTo(mainMap);
    }
    setTimeout(() => { mainMap.invalidateSize(); if (!fitted) fitToMarkers(); }, 0);
    drawMarkers();
  }

  function pinColor(s) {
    if (!s.count) return "#868e96";
    if (s.avg >= 4) return "#2b8a3e";
    if (s.avg >= 3) return "#f08c00";
    return "#c92a2a";
  }

  function drawMarkers() {
    if (!mainMap || !markerLayer) return;
    markerLayer.clearLayers();
    markersById.clear();
    for (const r of shown) {
      const s = stats(r.id);
      const label = s.count ? s.avg.toFixed(1) : "–"; // 只放程式產生的數字，不放使用者輸入的文字
      const icon = L.divIcon({
        className: "",
        html: `<div class="pin" style="background:${pinColor(s)}"><span>${label}</span></div>`,
        iconSize: [30, 30], iconAnchor: [15, 30], popupAnchor: [0, -28],
      });
      const m = L.marker([r.latitude, r.longitude], { icon, title: r.name, alt: r.name });
      m.bindPopup(() => popupContent(r));
      m.addTo(markerLayer);
      markersById.set(r.id, m);
    }
    $("map-note").textContent = shown.length
      ? `地圖上 ${shown.length} 家。顏色：綠＝4 分以上、橘＝3 分以上、紅＝3 分以下、灰＝尚無評分。`
      : "目前沒有符合條件的店家。";
    if (!fitted && shown.length) fitToMarkers();
  }

  function fitToMarkers() {
    if (!mainMap || !shown.length || $("map-view").hidden) return;
    fitted = true;
    if (shown.length === 1) mainMap.setView([shown[0].latitude, shown[0].longitude], 17);
    else mainMap.fitBounds(L.latLngBounds(shown.map((r) => [r.latitude, r.longitude])), { padding: [32, 32], maxZoom: 17 });
  }

  // 彈出視窗一律用 DOM 元素與 textContent 建立
  function popupContent(r) {
    const s = stats(r.id);
    const box = el("div");
    box.append(el("div", "pop-name", r.name));
    box.append(el("div", "pop-meta", `${scoreText(s)}${s.count ? `（${s.count} 人）` : ""}・${r.cuisine}${r.walk_minutes ? `・步行 ${r.walk_minutes} 分` : ""}`));
    const row = el("div", "item-actions");
    row.append(navLink(r), button(s.mine ? "看評價" : "評分", "ghost pop-btn", () => { mainMap.closePopup(); openDetail(r.id); }));
    box.append(row);
    return box;
  }

  function showOnMap(id) {
    setView("map");
    const m = markersById.get(id);
    if (!m) return;
    fitted = true;
    mainMap.setView(m.getLatLng(), 18);
    m.openPopup();
    window.scrollTo({ top: $("map-view").offsetTop - 70, behavior: "smooth" });
  }

  $("locate-btn").addEventListener("click", () => {
    if (!mainMap) return;
    if (!("geolocation" in navigator)) { $("map-note").textContent = "這個裝置不支援定位。"; return; }
    navigator.geolocation.getCurrentPosition((pos) => {
      const here = [pos.coords.latitude, pos.coords.longitude];
      if (myPosLayer) myPosLayer.remove();
      myPosLayer = L.circleMarker(here, { radius: 8, color: "#ffffff", weight: 2, fillColor: "#1c7ed6", fillOpacity: 1 }).addTo(mainMap);
      fitted = true;
      mainMap.setView(here, 17);
    }, () => { $("map-note").textContent = "無法取得目前位置，請確認已允許定位。"; },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  });

  // ---------- 店家詳情與評分 ----------
  const detail = $("detail");
  let detailId = null;
  $("detail-close").addEventListener("click", () => detail.close());

  function openDetail(id) {
    detailId = id;
    renderDetail();
    $("rate-message").hidden = true;
    $("rate-form").reset();
    detail.showModal();
  }

  function renderDetail() {
    const r = restaurants.find((x) => x.id === detailId);
    if (!r) return;
    const s = stats(r.id);
    $("detail-name").textContent = r.name;
    const sum = $("detail-summary");
    const score = el("p", "score", scoreText(s));
    if (s.count) score.append(el("small", "", `（${s.count} 人評分）`));
    const facts = el("dl", "facts");
    if (r.walk_minutes) addFact(facts, "步行", `${r.walk_minutes} 分鐘`);
    if (r.address) addFact(facts, "地址", r.address);
    if (r.signature_dishes) addFact(facts, "推薦", r.signature_dishes);
    if (r.opening_hours) addFact(facts, "營業", r.opening_hours);
    if (r.delivery !== null) addFact(facts, "外送", r.delivery ? "可以" : "不行");
    addFact(facts, "新增者", nameOf(r.created_by));
    addFact(facts, "加入日期", formatDate(r.created_at));
    const nav = el("p");
    nav.append(navLink(r));
    sum.replaceChildren(score, chipsFor(r, s), facts, nav);

    $("rate-form").hidden = !!s.mine;
    $("rate-done").hidden = !s.mine;
    if (s.mine) $("rate-done").textContent = `你已經評過：${"★".repeat(s.mine.score)}（${s.mine.score} 分）。需要更正請聯絡管理者。`;

    const reviews = $("detail-reviews");
    reviews.replaceChildren(...(s.list.length ? s.list.map((rt) => {
      const li = el("li", "review");
      const h = el("div", "review-head");
      h.append(el("span", "who", nameOf(rt.user_id) + (rt.user_id === me ? "（我）" : "")), el("span", "score", "★".repeat(rt.score) + "☆".repeat(5 - rt.score)));
      li.append(h);
      if (rt.comment) li.append(el("p", "", rt.comment));
      li.append(el("span", "muted small", formatDate(rt.created_at)));
      return li;
    }) : [el("li", "muted", "還沒有人評分，來當第一個吧！")]));
  }

  $("rate-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const msg = $("rate-message");
    msg.hidden = true;
    const picked = $("rate-form").querySelector("input[name=score]:checked");
    if (!picked) return showMsg(msg, "請先點星星選擇分數。");
    const comment = $("rate-comment").value.trim();
    if (comment.length > 200) return showMsg(msg, "短評最多 200 字。");
    const btn = $("rate-btn");
    btn.disabled = true;
    btn.textContent = "送出中…";
    try {
      // 只送店家、分數、短評；評分者由資料庫自動帶入本人
      const { error } = await client.from(T.ratings).insert({ restaurant_id: detailId, score: Number(picked.value), comment: comment || null });
      if (error) throw error;
      await loadAll();
      renderDetail();
    } catch (err) {
      console.error(err);
      showMsg(msg, err && err.code === "23505" ? "你已經評過這家店了，每家只能評一次。" : "評分失敗：" + describeError(err));
      if (err && err.code === "23505") { await loadAll(); renderDetail(); }
    } finally {
      btn.disabled = false;
      btn.textContent = "送出評價";
    }
  });

  // ---------- 新增店家 ----------
  const editor = $("editor");
  const editorForm = $("editor-form");
  const editorMsg = $("editor-message");
  let editMap = null;
  let editMarker = null;
  $("add-btn").addEventListener("click", openEditor);
  $("editor-close").addEventListener("click", () => editor.close());

  function openEditor() {
    editorForm.reset();
    editorMsg.hidden = true;
    $("place-results").replaceChildren();
    $("place-status").hidden = true;
    $("place-credit").hidden = true;
    clearPos();
    editor.showModal();
    if (HAS_MAP) {
      if (!editMap) {
        editMap = L.map("e-map", { zoomControl: true }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
        addTiles(editMap);
        editMap.on("click", (e) => setPos(e.latlng.lat, e.latlng.lng));
      }
      setTimeout(() => {
        editMap.invalidateSize();
        if (mainMap && fitted) editMap.setView(mainMap.getCenter(), Math.max(mainMap.getZoom(), 15));
        else editMap.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
      }, 50);
    } else {
      $("e-map").hidden = true;
      $("e-coords").textContent = "地圖載入失敗，請用上方搜尋找位置。";
    }
    $("place-q").focus();
  }

  const round6 = (n) => Math.round(n * 1e6) / 1e6;
  function setPos(lat, lon) {
    lat = round6(lat);
    lon = round6(((lon + 540) % 360) - 180);
    $("e-lat").value = String(lat);
    $("e-lon").value = String(lon);
    if (HAS_MAP && editMap) {
      if (editMarker) editMarker.setLatLng([lat, lon]);
      else editMarker = L.circleMarker([lat, lon], { radius: 9, weight: 2, color: "#ffffff", fillColor: "#d9480f", fillOpacity: 1 }).addTo(editMap);
    }
    $("e-coords").textContent = `已設定位置：${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  }
  function clearPos() {
    $("e-lat").value = "";
    $("e-lon").value = "";
    if (editMarker) { editMarker.remove(); editMarker = null; }
    $("e-coords").textContent = "尚未設定位置";
  }

  // 搜尋位置（OpenStreetMap Nominatim，免金鑰）：按下才查、每秒最多一次、只找臺灣、標示來源
  let lastSearch = 0;
  $("place-btn").addEventListener("click", searchPlace);
  $("place-q").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); searchPlace(); } });

  async function searchPlace() {
    const q = $("place-q").value.trim();
    const status = $("place-status");
    status.hidden = false;
    if (!q) { status.textContent = "請輸入店名或地址。"; return; }
    if (!navigator.onLine) { status.textContent = "目前離線，無法搜尋。"; return; }
    const wait = 1000 - (Date.now() - lastSearch);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastSearch = Date.now();
    const btn = $("place-btn");
    btn.disabled = true;
    status.textContent = "搜尋中…";
    $("place-results").replaceChildren();
    try {
      const params = new URLSearchParams({ q, format: "jsonv2", limit: "6", countrycodes: "tw", "accept-language": "zh-TW,zh,en" });
      const res = await fetch(PLACE_API + "?" + params, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      const items = (Array.isArray(data) ? data : []).filter((p) => isFinite(parseFloat(p.lat)) && isFinite(parseFloat(p.lon)));
      $("place-results").replaceChildren(...items.map((p) => {
        const name = String(p.name || String(p.display_name || "").split(",")[0] || "").trim();
        const parts = String(p.display_name || "").split(",").map((x) => x.trim()).filter(Boolean);
        if (parts.length && name.includes(parts[0])) parts.shift();
        const addr = parts.join(", ");
        const li = el("li");
        const b = el("button");
        b.type = "button";
        b.append(el("span", "pn", name || "（未命名地點）"), el("span", "pa", addr));
        b.addEventListener("click", () => {
          const lat = parseFloat(p.lat), lon = parseFloat(p.lon);
          setPos(lat, lon);
          if (editMap) editMap.setView([lat, lon], 18);
          if (!editorForm.elements.name.value.trim() && name) editorForm.elements.name.value = clip(name, MAX_LEN.name);
          if (!editorForm.elements.address.value.trim() && addr) editorForm.elements.address.value = clip(addr, MAX_LEN.address);
          $("place-results").replaceChildren();
          status.textContent = "已帶入位置，請確認店名與地址。";
        });
        li.append(b);
        return li;
      }));
      $("place-credit").hidden = !items.length;
      status.textContent = items.length ? `找到 ${items.length} 個地點，點一下帶入。` : "找不到，試試加上路名或區名，或直接點地圖。";
    } catch (err) {
      console.error(err);
      status.textContent = /HTTP 429/.test(String(err.message)) ? "搜尋太頻繁，請稍等一下再試。" : "搜尋失敗，請稍後再試，或直接點地圖。";
    } finally {
      btn.disabled = false;
    }
  }

  editorForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    editorMsg.hidden = true;
    const record = collect();
    const invalid = validate(record);
    if (invalid) {
      showMsg(editorMsg, invalid.message);
      if (invalid.field && editorForm.elements[invalid.field]) editorForm.elements[invalid.field].focus();
      else editorMsg.scrollIntoView({ block: "nearest" });
      return;
    }
    const btn = $("save-btn");
    btn.disabled = true;
    btn.textContent = "新增中…";
    try {
      // 只送內容欄位；id、新增者、時間由資料庫產生
      const { error } = await client.from(T.restaurants).insert(record);
      if (error) throw error;
      editor.close();
      fitted = false;
      await loadAll();
    } catch (err) {
      console.error(err);
      showMsg(editorMsg, "新增失敗：" + describeError(err));
    } finally {
      btn.disabled = false;
      btn.textContent = "新增店家";
    }
  });

  function collect() {
    const r = {};
    for (const f of REST_FIELDS) {
      const raw = String(editorForm.elements[f].value || "").trim();
      r[f] = raw === "" ? null : raw;
    }
    r.latitude = r.latitude === null ? null : Number(r.latitude);
    r.longitude = r.longitude === null ? null : Number(r.longitude);
    r.walk_minutes = r.walk_minutes === null ? null : Number(r.walk_minutes);
    r.delivery = r.delivery === null ? null : r.delivery === "true";
    return r;
  }

  function validate(r) {
    if (!r.name) return { field: "name", message: "請填寫店名。" };
    if (!CUISINES.includes(r.cuisine || "")) return { field: "cuisine", message: "請選擇料理類型。" };
    if (r.latitude === null || r.longitude === null) return { field: null, message: "請用搜尋或點地圖設定店家位置。" };
    for (const [f, max] of Object.entries(MAX_LEN)) {
      if (r[f] && r[f].length > max) return { field: f, message: `${LABELS[f]}最多 ${max} 字。` };
    }
    if (r.walk_minutes !== null && !(Number.isInteger(r.walk_minutes) && r.walk_minutes >= 1 && r.walk_minutes <= 60)) {
      return { field: "walk_minutes", message: "步行分鐘請填 1～60 的整數。" };
    }
    return null;
  }

  // ---------- 小工具 ----------
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }
  function button(text, className, onClick, label) {
    const b = el("button", className, text);
    b.type = "button";
    if (label) b.setAttribute("aria-label", label);
    b.addEventListener("click", onClick);
    return b;
  }
  function addFact(dl, label, value) { dl.append(el("dt", "", label), el("dd", "", value)); }
  function formatDate(v) { const d = new Date(v); return isNaN(d) ? "" : dateFormat.format(d); }
  function clip(t, max) { const s = String(t || "").trim(); return s.length > max ? s.slice(0, max).trim() : s; }
  function showMsg(box, text) { box.textContent = text; box.hidden = false; }
  function describeAuthError(err) {
    if (!navigator.onLine) return "目前離線，請連上網路後再登入。";
    const m = String((err && err.message) || "");
    if (/invalid login credentials/i.test(m)) return "Email 或密碼錯誤。";
    if (/email not confirmed/i.test(m)) return "這個帳號的 Email 尚未驗證，請聯絡管理者。";
    if (/fetch|network/i.test(m)) return "無法連線到伺服器，請稍後再試。";
    return m || "登入失敗，請稍後再試。";
  }
  function describeError(err) {
    if (!navigator.onLine) return "目前離線，請連上網路後再試。";
    const code = err && err.code;
    if (code === "42501") return "沒有權限，請重新登入；若仍失敗請聯絡管理者確認資料庫設定。";
    if (code === "23514") return "資料格式不符合規定，請檢查各欄位內容與字數。";
    if (code === "42P01" || code === "PGRST205") return "找不到資料表，請先執行 supabase/schema.sql。";
    if (code === "PGRST301" || /jwt/i.test(String(err && err.message))) return "登入已過期，請重新登入。";
    if (err && /fetch|network/i.test(String(err.message))) return "無法連線到伺服器，請稍後再試。";
    return (err && err.message) || "發生未知錯誤，請稍後再試。";
  }
  function checkConfig(c) {
    if (!window.supabase || typeof window.supabase.createClient !== "function") return "無法載入 Supabase 程式庫，請連上網路後重新開啟。";
    const url = String(c.supabaseUrl || ""), key = String(c.supabaseKey || "");
    if (!/^https:\/\/\S+$/.test(url) || !key) return "尚未設定 Supabase 連線：請在 config.js 填入專案網址與 publishable key。";
    if (!/^sb_publishable_/.test(key)) return "config.js 只能放 publishable key（sb_publishable_ 開頭），請立刻移除其他金鑰。";
    return null;
  }
})();
