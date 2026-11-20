(() => {
  if (window.__rkBhaiVisitorTracked) return;
  window.__rkBhaiVisitorTracked = true;
  const isGithubPages = location.hostname === "jasmelsolanki2017-svg.github.io";
  const site = isGithubPages ? "github_pages" : "render";
  const endpoint = "https://rk-bhai-results-portal.onrender.com/api/visitor/track";
  fetch(endpoint, {
    method: "POST",
    mode: "cors",
    credentials: "omit",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ site })
  }).catch(error => console.info("Visitor tracking is temporarily unavailable:", error));
})();
