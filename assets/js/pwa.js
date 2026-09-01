if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("sw.js").then(function (reg) {
      // Don't wait for the browser's own (up to ~24h) background check —
      // ask right now whether sw.js changed, so updates show up on the
      // very next visit instead of some indeterminate later one.
      reg.update().catch(function () {});
    }).catch(function () { /* offline install is a bonus, not required */ });

    // When a new service worker takes over, reload once to pick up the
    // matching fresh HTML/CSS/JS as a set. Deferred while the mic monitor
    // is running so an update never yanks the page out from under an
    // in-progress test — see audio-check.js's window.__appBusy.
    var reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (reloaded) return;
      (function waitUntilIdle() {
        if (window.__appBusy) { setTimeout(waitUntilIdle, 1000); return; }
        reloaded = true;
        window.location.reload();
      })();
    });
  });
}

(function () {
  var banner = document.getElementById("installBanner");
  var text = document.getElementById("installBannerText");
  var installBtn = document.getElementById("installBtn");
  var dismissBtn = document.getElementById("installDismissBtn");
  if (!banner || !text || !installBtn || !dismissBtn) return;

  if (localStorage.getItem("installBannerDismissed") === "1") return;

  var isStandalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  if (isStandalone) return; // already installed, nothing to offer

  var ua = navigator.userAgent;
  var isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var isFirefox = /Firefox/.test(ua) && !/Seamonkey/.test(ua);
  // Firefox has no manifest-based install path (desktop or Android) — showing
  // instructions there would just be wrong, so there is nothing to offer.
  if (isFirefox) return;

  var deferredPrompt = null;
  var dismissed = false;

  function show(message, withButton) {
    if (dismissed) return;
    text.textContent = message;
    installBtn.classList.toggle("status-hidden", !withButton);
    banner.classList.remove("status-hidden");
  }

  function dismiss() {
    dismissed = true;
    banner.classList.add("status-hidden");
    localStorage.setItem("installBannerDismissed", "1");
  }

  dismissBtn.addEventListener("click", dismiss);
  window.addEventListener("appinstalled", dismiss);

  if (isIOS) {
    // iOS Safari (and iOS Chrome/Brave, which reuse WebKit) never fires an
    // install event — "Add to Home Screen" is only reachable via the Share
    // sheet, so the best this banner can do is point at it.
    show("Instale este app: toque em Compartilhar e depois em “Adicionar à Tela de Início”.", false);
    return;
  }

  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferredPrompt = e;
    show("Instale este site como app no seu celular ou computador.", true);
  });

  installBtn.addEventListener("click", function () {
    if (!deferredPrompt) return;
    var prompt = deferredPrompt;
    deferredPrompt = null;
    banner.classList.add("status-hidden");
    prompt.prompt();
  });

  // Chromium browsers (Chrome, Brave, Edge, Samsung Internet) gate the
  // automatic prompt behind their own engagement heuristics — it may not
  // fire on a first visit, or at all in some builds. If it hasn't shown up
  // after a few seconds, fall back to pointing at the browser's own menu,
  // which always works once the manifest/service-worker criteria are met.
  setTimeout(function () {
    if (!deferredPrompt) {
      show("Instale este app: toque no menu do navegador (⋮ ou ≡) e escolha “Adicionar à tela inicial” ou “Instalar aplicativo”.", false);
    }
  }, 3000);
})();
