(() => {
  if (window.__rkBhaiVisitorTracked) return;
  window.__rkBhaiVisitorTracked = true;

  const isGithubPages = location.hostname === "jasmelsolanki2017-svg.github.io";
  const site = isGithubPages ? "github_pages" : "render";
  const endpoint = "https://rk-bhai-results-portal.onrender.com";
  const trackEndpoint = endpoint + "/api/visitor/track";
  const heartbeatEndpoint = endpoint + "/api/visitor/heartbeat";
  const onlineEndpoint = endpoint + "/api/public/online";

  // Keep a random, tab-scoped identifier only; no IP address or personal details are collected.
  let sessionId = "";
  try {
    sessionId = sessionStorage.getItem("rkBhaiOnlineSession") || "";
    if (!/^[a-f0-9-]{20,64}$/i.test(sessionId)) {
      sessionId = crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === "x" ? r : (r & 3 | 8)).toString(16);
      });
      sessionStorage.setItem("rkBhaiOnlineSession", sessionId);
    }
  } catch (_) {}

  fetch(trackEndpoint, {
    method: "POST", mode: "cors", credentials: "omit", keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ site })
  }).catch(error => console.info("Visitor tracking is temporarily unavailable:", error));

  const onlineCount = document.getElementById("onlineMemberCount");
  async function updateOnlineStatus() {
    if (sessionId) {
      fetch(heartbeatEndpoint, {
        method: "POST", mode: "cors", credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site, sessionId })
      }).catch(() => {});
    }
    if (!onlineCount) return;
    try {
      const response = await fetch(onlineEndpoint, { mode: "cors", cache: "no-store", credentials: "omit" });
      if (!response.ok) throw new Error("Online count unavailable");
      const data = await response.json();
      onlineCount.textContent = Number.isFinite(data.online) ? data.online.toLocaleString("en-IN") : "—";
    } catch (_) {
      onlineCount.textContent = "—";
    }
  }
  updateOnlineStatus();
  window.setInterval(updateOnlineStatus, 30000);
})();