const owner = "jasmelsolanki2017-svg";
const repo = "rk-bhai-results-portal-";
const workflow = "automatic-result-sync.yml";
const token = process.env.GITHUB_TOKEN;

if (!token) {
  console.error("Missing GITHUB_TOKEN. Add a GitHub token with Actions: write permission in Render environment variables.");
  process.exit(1);
}

const headers = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "X-GitHub-Api-Version": "2022-11-28",
};

async function main() {
  const runsUrl = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/runs?per_page=1`;
  const runsResponse = await fetch(runsUrl, { headers });
  if (!runsResponse.ok) {
    throw new Error(`GitHub runs API returned HTTP ${runsResponse.status}: ${await runsResponse.text()}`);
  }

  const data = await runsResponse.json();
  const latest = data.workflow_runs?.[0];
  const now = Date.now();
  const latestAt = latest ? Date.parse(latest.created_at) : 0;
  const ageMinutes = latest ? (now - latestAt) / 60000 : Infinity;

  if (latest && ageMinutes < 7) {
    console.log(`Backup scheduler skipped: latest workflow run #${latest.run_number} was created ${ageMinutes.toFixed(1)} minutes ago (status: ${latest.status}).`);
    return;
  }

  const dispatchUrl = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`;
  const dispatchResponse = await fetch(dispatchUrl, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ ref: "main" }),
  });

  if (dispatchResponse.status !== 204) {
    throw new Error(`GitHub workflow dispatch returned HTTP ${dispatchResponse.status}: ${await dispatchResponse.text()}`);
  }
  console.log("Backup scheduler dispatched Automatic Result Sync on main.");
}

main().catch((error) => {
  console.error("External scheduler failed:", error);
  process.exit(1);
});
