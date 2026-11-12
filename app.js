// 報修登記前端：新增報修，並顯示最近 20 筆。
// 資料表與權限設計見 supabase/schema.sql。
(function () {
  "use strict";

  const TABLE = "repair_requests";
  const LIST_LIMIT = 20;
  // 與資料庫 CHECK 限制一致的字數上限
  const MAX_LEN = { reporter_name: 50, location: 100, description: 1000 };
  const CATEGORIES = ["設備", "網路", "環境", "其他"];
  const URGENCIES = ["低", "中", "高"];

  const $ = (id) => document.getElementById(id);
  const form = $("repair-form");
  const submitBtn = $("submit-btn");
  const formMessage = $("form-message");
  const listEl = $("repair-list");
  const listStatus = $("list-status");
  const refreshBtn = $("refresh-btn");
  const descInput = $("description");
  const descCount = $("desc-count");

  const timeFormat = new Intl.DateTimeFormat("zh-TW", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });

  // ---------- 連線設定檢查 ----------
  const cfg = window.APP_CONFIG || {};
  const configProblem = checkConfig(cfg);
  if (configProblem) {
    showConfigWarning(configProblem);
    return;
  }
  const client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ---------- 事件 ----------
  descInput.addEventListener("input", () => {
    descCount.textContent = String(descInput.value.length);
  });
  form.addEventListener("submit", onSubmit);
  refreshBtn.addEventListener("click", loadList);

  loadList();

  // ---------- 送出 ----------
  async function onSubmit(event) {
    event.preventDefault();
    hideMessage();

    const data = new FormData(form);
    const record = {
      reporter_name: String(data.get("reporter_name") || "").trim(),
      location: String(data.get("location") || "").trim(),
      category: String(data.get("category") || ""),
      description: String(data.get("description") || "").trim(),
      urgency: String(data.get("urgency") || ""),
    };
    // 注意：不送 status、id、created_at，由資料庫自動產生。

    const error = validate(record);
    if (error) {
      showMessage(error.message, false);
      if (error.field) $(error.field).focus();
      return;
    }

    setBusy(true);
    try {
      const { error: dbError } = await client.from(TABLE).insert(record);
      if (dbError) throw dbError;
      form.reset();
      descCount.textContent = "0";
      showMessage("送出成功！已新增一筆報修。", true);
      await loadList();
    } catch (err) {
      console.error(err);
      showMessage("送出失敗：" + describeError(err), false);
    } finally {
      setBusy(false);
    }
  }

  function validate(r) {
    if (!r.reporter_name) return { field: "reporter_name", message: "請填寫報修人。" };
    if (r.reporter_name.length > MAX_LEN.reporter_name) return { field: "reporter_name", message: "報修人最多 50 字。" };
    if (!r.location) return { field: "location", message: "請填寫地點或部門。" };
    if (r.location.length > MAX_LEN.location) return { field: "location", message: "地點或部門最多 100 字。" };
    if (!CATEGORIES.includes(r.category)) return { field: "category", message: "請選擇類別。" };
    if (!r.description) return { field: "description", message: "請填寫問題說明。" };
    if (r.description.length > MAX_LEN.description) return { field: "description", message: "問題說明最多 1000 字。" };
    if (!URGENCIES.includes(r.urgency)) return { field: "urgency-mid", message: "請選擇緊急程度。" };
    return null;
  }

  // ---------- 清單 ----------
  async function loadList() {
    refreshBtn.disabled = true;
    listStatus.hidden = false;
    listStatus.textContent = "載入中…";
    try {
      const { data, error } = await client
        .from(TABLE)
        .select("id, created_at, reporter_name, location, category, description, urgency, status")
        .order("created_at", { ascending: false })
        .limit(LIST_LIMIT);
      if (error) throw error;
      renderList(data || []);
    } catch (err) {
      console.error(err);
      listEl.replaceChildren();
      listStatus.textContent = "清單載入失敗：" + describeError(err);
    } finally {
      refreshBtn.disabled = false;
    }
  }

  function renderList(rows) {
    listEl.replaceChildren();
    if (rows.length === 0) {
      listStatus.textContent = "目前還沒有報修。";
      return;
    }
    listStatus.hidden = true;
    for (const row of rows) {
      // 一律用 textContent 放入使用者輸入的內容，避免 XSS
      const li = el("li", "repair-item");
      const top = el("div", "item-top");
      top.append(
        el("span", "tag", row.category),
        el("span", "tag tag-" + row.urgency, "緊急：" + row.urgency),
        el("span", "tag", row.status)
      );
      li.append(
        top,
        el("p", "item-desc", row.description),
        el("div", "item-meta", row.reporter_name + "・" + row.location + "・" + formatTime(row.created_at))
      );
      listEl.append(li);
    }
  }

  // ---------- 小工具 ----------
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function formatTime(value) {
    const d = new Date(value);
    return isNaN(d) ? "" : timeFormat.format(d);
  }

  function setBusy(busy) {
    submitBtn.disabled = busy;
    submitBtn.textContent = busy ? "送出中…" : "送出報修";
  }

  function showMessage(text, ok) {
    formMessage.textContent = text;
    formMessage.className = "notice " + (ok ? "notice-ok" : "notice-error");
    formMessage.hidden = false;
  }

  function hideMessage() {
    formMessage.hidden = true;
  }

  function describeError(err) {
    if (!navigator.onLine) return "目前沒有網路連線，請稍後再試。";
    const code = err && err.code;
    if (code === "42501") return "沒有權限執行這個操作，請聯絡管理員確認資料庫權限設定。";
    if (code === "23514") return "資料格式不符合規定，請檢查各欄位內容與字數。";
    if (code === "42P01" || code === "PGRST205") return "找不到報修資料表，請聯絡管理員確認資料庫已建立。";
    if (err && /fetch|network/i.test(String(err.message))) return "無法連線到伺服器，請稍後再試。";
    return (err && err.message) || "發生未知錯誤，請稍後再試。";
  }

  function checkConfig(c) {
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      return "無法載入 Supabase 程式庫，請檢查網路連線後重新整理頁面。";
    }
    const url = String(c.supabaseUrl || "");
    const key = String(c.supabaseKey || "");
    if (!/^https:\/\/[^\s【】]+$/.test(url) || !key || /[【】]/.test(key)) {
      return "尚未設定 Supabase 連線：請在 config.js 填入專案網址與 publishable key。";
    }
    if (/^sb_secret_/.test(key)) {
      return "config.js 裡放的是 secret 金鑰，請立刻移除並改用 publishable key。";
    }
    return null;
  }

  function showConfigWarning(text) {
    const box = $("config-warning");
    box.textContent = text;
    box.hidden = false;
    submitBtn.disabled = true;
    refreshBtn.disabled = true;
    listStatus.textContent = "尚未連線，無法載入清單。";
  }
})();
