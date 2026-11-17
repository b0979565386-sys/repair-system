// PWA：註冊 Service Worker、顯示「安裝 App」按鈕與離線提示。
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch((err) => console.warn("Service Worker 註冊失敗", err));
    });
  }

  let installPrompt = null;
  const installBtn = $("install-btn");
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    if (installBtn) installBtn.hidden = false;
  });
  if (installBtn) {
    installBtn.addEventListener("click", async () => {
      if (!installPrompt) return;
      installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
      installBtn.hidden = true;
    });
  }
  window.addEventListener("appinstalled", () => { if (installBtn) installBtn.hidden = true; });

  const banner = $("offline-banner");
  const update = () => { if (banner) banner.hidden = navigator.onLine; };
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  update();
})();
