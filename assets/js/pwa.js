if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("sw.js").catch(function () { /* offline install is a bonus, not required */ });
  });
}

(function () {
  var banner = document.getElementById("installBanner");
  var installBtn = document.getElementById("installBtn");
  var dismissBtn = document.getElementById("installDismissBtn");
  if (!banner || !installBtn || !dismissBtn) return;

  if (localStorage.getItem("installBannerDismissed") === "1") return;

  var deferredPrompt = null;

  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferredPrompt = e;
    banner.classList.remove("status-hidden");
  });

  installBtn.addEventListener("click", function () {
    if (!deferredPrompt) return;
    var prompt = deferredPrompt;
    deferredPrompt = null;
    banner.classList.add("status-hidden");
    prompt.prompt();
  });

  dismissBtn.addEventListener("click", function () {
    banner.classList.add("status-hidden");
    localStorage.setItem("installBannerDismissed", "1");
  });

  window.addEventListener("appinstalled", function () {
    banner.classList.add("status-hidden");
    localStorage.setItem("installBannerDismissed", "1");
  });
})();
