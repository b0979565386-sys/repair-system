// 聚餐餐廳清單：只讀取 restaurant_options，在瀏覽器端篩選與排序。
// 一般同事只能查看；新增、修改、刪除由主辦人在 Supabase 後台操作。
// 資料表與權限設計見 supabase/schema.sql。
(function () {
  "use strict";

  const TABLE = "restaurant_options";
  const MAX_ROWS = 500;
  const BUDGET_ORDER = { "500 元以下": 1, "500～1000 元": 2, "1000 元以上": 3 };

  const $ = (id) => document.getElementById(id);
  const listEl = $("restaurant-list");
  const listStatus = $("list-status");
  const refreshBtn = $("refresh-btn");
  const filters = {
    cuisine: $("f-cuisine"),
    budget: $("f-budget"),
    people: $("f-people"),
    sort: $("f-sort"),
    room: $("f-room"),
  };

  const timeFormat = new Intl.DateTimeFormat("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit" });
  let allRows = [];

  // ---------- 連線設定檢查 ----------
  const cfg = window.APP_CONFIG || {};
  const configProblem = checkConfig(cfg);
  if (configProblem) {
    const box = $("config-warning");
    box.textContent = configProblem;
    box.hidden = false;
    refreshBtn.disabled = true;
    listStatus.textContent = "尚未連線，無法載入清單。";
    return;
  }
  const client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ---------- 事件 ----------
  for (const key of ["cuisine", "budget", "sort", "room"]) filters[key].addEventListener("change", render);
  filters.people.addEventListener("input", render);
  $("reset-btn").addEventListener("click", () => {
    filters.cuisine.value = "";
    filters.budget.value = "";
    filters.people.value = "";
    filters.sort.value = "new";
    filters.room.checked = false;
    render();
  });
  refreshBtn.addEventListener("click", load);

  load();

  // ---------- 讀取 ----------
  async function load() {
    refreshBtn.disabled = true;
    listStatus.hidden = false;
    listStatus.textContent = "載入中…";
    try {
      const { data, error } = await client
        .from(TABLE)
        .select("id, created_at, name, area_or_address, cuisine, budget_range, capacity, has_private_room, recommender, reason, url")
        .order("created_at", { ascending: false })
        .limit(MAX_ROWS);
      if (error) throw error;
      allRows = data || [];
      render();
    } catch (err) {
      console.error(err);
      allRows = [];
      listEl.replaceChildren();
      listStatus.textContent = "清單載入失敗：" + describeError(err);
    } finally {
      refreshBtn.disabled = false;
    }
  }

  // ---------- 篩選、排序、顯示 ----------
  function render() {
    const cuisine = filters.cuisine.value;
    const budget = filters.budget.value;
    const people = parseInt(filters.people.value, 10);
    const onlyRoom = filters.room.checked;

    const rows = allRows.filter((r) =>
      (!cuisine || r.cuisine === cuisine) &&
      (!budget || r.budget_range === budget) &&
      (!(people > 0) || r.capacity >= people) &&
      (!onlyRoom || r.has_private_room)
    );

    const sort = filters.sort.value;
    if (sort === "capacity") rows.sort((a, b) => b.capacity - a.capacity);
    else if (sort === "budget") rows.sort((a, b) => (BUDGET_ORDER[a.budget_range] || 9) - (BUDGET_ORDER[b.budget_range] || 9));
    // "new"：維持資料庫回傳的新到舊順序

    listEl.replaceChildren();
    listStatus.hidden = false;
    if (allRows.length === 0) {
      listStatus.textContent = "目前還沒有餐廳選項。";
      return;
    }
    if (rows.length === 0) {
      listStatus.textContent = "沒有符合條件的餐廳，試著放寬篩選條件。";
      return;
    }
    listStatus.textContent = rows.length === allRows.length
      ? `共 ${rows.length} 家餐廳`
      : `符合條件 ${rows.length} 家（共 ${allRows.length} 家）`;

    for (const r of rows) listEl.append(card(r));
  }

  function card(r) {
    // 一律用 textContent 放入資料內容，避免 XSS
    const li = el("li", "restaurant");
    li.append(el("h3", "", r.name));

    const chips = el("div", "chips");
    chips.append(el("span", "chip", r.cuisine), el("span", "chip", r.budget_range));
    chips.append(el("span", "chip" + (r.has_private_room ? " chip-room" : ""), r.has_private_room ? "有包廂" : "無包廂"));
    li.append(chips);

    const facts = el("dl", "facts");
    addFact(facts, "地點", r.area_or_address);
    addFact(facts, "可容納", r.capacity + " 人");
    if (r.recommender) addFact(facts, "推薦人", r.recommender);
    addFact(facts, "登記", formatDate(r.created_at));
    li.append(facts);

    if (r.reason) li.append(el("p", "reason", r.reason));

    const href = safeUrl(r.url);
    if (href) {
      const a = el("a", "site-link", "餐廳網站 ↗");
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      li.append(a);
    }
    return li;
  }

  // ---------- 小工具 ----------
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function addFact(dl, label, value) {
    dl.append(el("dt", "", label), el("dd", "", value));
  }

  function formatDate(value) {
    const d = new Date(value);
    return isNaN(d) ? "" : timeFormat.format(d);
  }

  // 只接受 http/https 網址，避免 javascript: 之類的連結
  function safeUrl(value) {
    if (!value) return null;
    try {
      const u = new URL(value);
      return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
    } catch (_) {
      return null;
    }
  }

  function describeError(err) {
    if (!navigator.onLine) return "目前沒有網路連線，請稍後再試。";
    const code = err && err.code;
    if (code === "42501") return "沒有讀取權限，請聯絡主辦人確認資料庫權限設定。";
    if (code === "42P01" || code === "PGRST205") return "找不到餐廳資料表，請聯絡主辦人確認資料庫已建立。";
    if (err && /fetch|network/i.test(String(err.message))) return "無法連線到伺服器，請稍後再試。";
    return (err && err.message) || "發生未知錯誤，請稍後再試。";
  }

  function checkConfig(c) {
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      return "無法載入 Supabase 程式庫，請檢查網路連線後重新整理頁面。";
    }
    const url = String(c.supabaseUrl || "");
    const key = String(c.supabaseKey || "");
    if (!/^https:\/\/\S+$/.test(url) || !key) {
      return "尚未設定 Supabase 連線：請在 config.js 填入專案網址與 publishable key。";
    }
    if (!/^sb_publishable_/.test(key)) {
      return "config.js 只能放 publishable key（sb_publishable_ 開頭），請立刻移除其他金鑰。";
    }
    return null;
  }
})();
