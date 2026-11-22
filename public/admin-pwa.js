(() => {
  const installButton = document.getElementById("installAdminApp");
  if (!installButton) return;
  let deferredPrompt = null;
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  if (isStandalone) {
    installButton.hidden = true;
    return;
  }
  installButton.hidden = false;
  installButton.addEventListener("click", async () => {
    if (!deferredPrompt) {
      alert("Chrome के ऊपर ⋮ मेन्यू खोलें और 'Install app' या 'Add to Home screen' चुनें।");
      return;
    }
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installButton.hidden = true;
  });
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredPrompt = event;
    installButton.hidden = false;
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    installButton.hidden = true;
  });
})();