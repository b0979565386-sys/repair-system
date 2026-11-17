// 夜景餐廳口袋名單（PWA，不用登入）
// 打開就能新增、修改、刪除、篩選夜景餐廳。
// 資料表與權限設計見 supabase/schema.sql：不用登入，任何拿到網址的人都能讀寫。
(function () {
  "use strict";

  const TABLE = "night_view_restaurants";
  const FIELDS = ["name", "city", "address", "url", "view_type", "floor_or_height", "window_seat",
    "price_range", "reservation", "opening_hours", "rating", "reason", "recommender", "visited_on"];
  const MAX_LEN = { name: 100, city: 50, address: 200, url: 500, floor_or_height: 50, opening_hours: 100, reason: 500, recommender: 50 };
  const LABELS = { name: "餐廳名稱", city: "城市或地區", address: "地址", url: "餐廳網址", floor_or_height: "樓層或高度", opening_hours: "營業時間", reason: "推薦理由", recommender: "推薦人" };

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
        .select("id, created_at, " + FIELDS.join(", "))
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
    filters.city.replaceChildren(new Option("全部城市", ""), ...cities.map((c) => new Option(c, c)));
    filters.city.value = cities.includes(keep) ? keep : "";
    $("city-options").replaceChildren(...cities.map((c) => new Option(c)));
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
    if (rows.length === 0) listStatus.textContent = "還沒有夜景餐廳，按右下角「＋」新增第一家。";
    else if (shown.length === 0) listStatus.textContent = "沒有符合條件的餐廳，試著放寬篩選條件。";
    else listStatus.textContent = shown.length === rows.length ? `共 ${rows.length} 家` : `符合條件 ${shown.length} 家（共 ${rows.length} 家）`;
  }

  function card(r) {
    // 一律用 textContent 放入資料內容，避免 XSS
    const li = el("li", "item");
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
    const edit = el("button", "ghost", "修改");
    edit.type = "button";
    edit.setAttribute("aria-label", "修改 " + r.name);
    edit.addEventListener("click", () => openEditor(r));
    actions.append(edit);
    li.append(actions);
    return li;
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
      });
      const res = await fetch(PLACE_API + "?" + params.toString(), { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      const places = (Array.isArray(data) ? data : []).map(toPlace).filter((p) => p.name);
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
    const city = a.city || a.town || a.county || a.village || a.state || a.country || "";
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
    const lat = Number(p.lat), lon = Number(p.lon);
    if (isFinite(lat) && isFinite(lon)) {
      const a = el("a", "", "在地圖查看 ↗");
      a.href = `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      actions.append(a);
    } else {
      actions.append(el("span"));
    }
    const add = el("button", "primary", "加入清單");
    add.type = "button";
    add.setAttribute("aria-label", "把 " + p.name + " 加入清單");
    add.addEventListener("click", () => openEditor(null, { name: p.name, city: p.city, address: p.address, url: p.url }));
    actions.append(add);
    li.append(actions);
    return li;
  }

  function clip(text, max) {
    const s = String(text || "").trim();
    return s.length > max ? s.slice(0, max).trim() : s;
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
    const src = row || prefill || {};
    for (const f of FIELDS) {
      const input = editorForm.elements[f];
      if (input) input.value = src[f] !== null && src[f] !== undefined ? String(src[f]) : "";
    }
    editor.showModal();
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
      return;
    }
    const btn = $("save-btn");
    btn.disabled = true;
    btn.textContent = "儲存中…";
    try {
      // 只送內容欄位；id、owner_id、時間欄位由資料庫產生
      const query = editingId
        ? client.from(TABLE).update(record).eq("id", editingId)
        : client.from(TABLE).insert(record);
      const { error } = await query;
      if (error) throw error;
      editor.close();
      await load();
    } catch (err) {
      console.error(err);
      showMsg(editorMsg, "儲存失敗：" + describeError(err));
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
      const { error } = await client.from(TABLE).delete().eq("id", editingId);
      if (error) throw error;
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
    return record;
  }

  function validate(r) {
    if (!r.name) return { field: "name", message: "請填寫餐廳名稱。" };
    if (!r.city) return { field: "city", message: "請填寫城市或地區。" };
    if (!r.view_type) return { field: "view_type", message: "請選擇夜景類型。" };
    for (const [f, max] of Object.entries(MAX_LEN)) {
      if (r[f] && r[f].length > max) return { field: f, message: `${LABELS[f]}最多 ${max} 字。` };
    }
    if (r.url && (!safeUrl(r.url) || /\s/.test(r.url))) return { field: "url", message: "餐廳網址必須以 http:// 或 https:// 開頭。" };
    return null;
  }

  // ---------- 小工具 ----------
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
