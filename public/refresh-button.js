(() => {
  if (document.getElementById("globalRefreshButton")) return;
  const style = document.createElement("style");
  style.textContent = `
    #globalRefreshButton{position:fixed;right:18px;bottom:22px;z-index:9998;display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:46px;padding:0 17px;border:1px solid #d7ad55;border-radius:999px;background:linear-gradient(145deg,#493719,#21190e);color:#ffe5a5;font:700 14px system-ui,Arial,sans-serif;box-shadow:0 5px 22px #0009;cursor:pointer}
    #globalRefreshButton:active{transform:scale(.96)}
    #globalRefreshButton .refresh-icon{font-size:20px;line-height:1}
    #globalRefreshButton:focus-visible{outline:3px solid #fff;outline-offset:3px}
    @media(max-width:600px){#globalRefreshButton{right:12px;bottom:84px;min-height:44px;padding:0 14px;font-size:13px}}
  `;
  document.head.appendChild(style);
  const button = document.createElement("button");
  button.id = "globalRefreshButton";
  button.type = "button";
  button.setAttribute("aria-label", "पेज और नया डेटा Refresh करें");
  button.innerHTML = '<span class="refresh-icon" aria-hidden="true">↻</span><span>Refresh</span>';
  button.addEventListener("click", () => {
    button.disabled = true;
    button.querySelector(".refresh-icon").textContent = "⟳";
    button.querySelector("span:last-child").textContent = "लोड हो रहा है…";
    window.location.reload();
  });
  document.body.appendChild(button);
})();