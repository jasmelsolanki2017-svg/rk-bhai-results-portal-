const API = "https://api.github.com";
const repo = process.env.GITHUB_REPOSITORY || "jasmelsolanki2017-svg/rk-bhai-results-portal-";
const token = process.env.GITHUB_TOKEN;
const branch = "public-data";
const headers = {
  Authorization: "Bearer " + token,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28"
};

async function readFile(path) {
  const response = await fetch(API + "/repos/" + repo + "/contents/" + path + "?ref=" + branch, { headers });
  if (!response.ok) throw new Error("GitHub read failed for " + path + ": HTTP " + response.status);
  const file = await response.json();
  return {
    sha: file.sha,
    text: Buffer.from(String(file.content || "").replace(/\n/g, ""), "base64").toString("utf8")
  };
}

async function writeFile(path, content, sha, message) {
  const response = await fetch(API + "/repos/" + repo + "/contents/" + path, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      content: Buffer.from(content, "utf8").toString("base64"),
      branch,
      ...(sha ? { sha } : {})
    })
  });
  if (!response.ok) throw new Error("GitHub write failed for " + path + ": HTTP " + response.status + " " + (await response.text()).slice(0, 250));
}

async function main() {
  if (!token) throw new Error("GITHUB_TOKEN is required");
  const statusFile = await readFile("data/auto-sync-status.json");
  const status = JSON.parse(statusFile.text);
  const diagnostics = Array.isArray(status.sourceDiagnostics) ? status.sourceDiagnostics : [];
  const parserByMarket = {};
  const aiByMarket = {};

  for (const item of diagnostics) {
    if (item.result !== "dated_values_found" || !item.marketValues) continue;
    const parsers = item.marketParsers || {};
    const host = (() => { try { return new URL(item.url).hostname.toLowerCase(); } catch { return item.url || "unknown"; } })();
    for (const [market, value] of Object.entries(item.marketValues)) {
      if (!/^\d{2}$/.test(String(value))) continue;
      const method = parsers[market] || "unknown";
      if (method === "deepseek_exact_source_evidence") {
        (aiByMarket[market] ||= []).push({ value: String(value), host, url: item.url, pass: item.pass || "" });
      } else {
        (parserByMarket[market] ||= []).push({ value: String(value), host, url: item.url, parser: method, pass: item.pass || "" });
      }
    }
  }

  const markets = [...new Set([...Object.keys(parserByMarket), ...Object.keys(aiByMarket)])].sort();
  const comparison = markets.map(market => {
    const parserRows = parserByMarket[market] || [];
    const aiRows = aiByMarket[market] || [];
    const parserValues = [...new Set(parserRows.map(row => row.value))].sort();
    const aiValues = [...new Set(aiRows.map(row => row.value))].sort();
    let verdict = "NO_DATA";
    if (aiValues.length && parserValues.length) {
      verdict = aiValues.some(value => parserValues.includes(value)) ? "MATCH" : "CONFLICT";
    } else if (aiValues.length) verdict = "AI_ONLY";
    else if (parserValues.length) verdict = "PARSER_ONLY";
    return {
      market,
      verdict,
      parserValues,
      parserDomains: [...new Set(parserRows.map(row => row.host))],
      parserObservations: parserRows,
      aiValues,
      aiObservations: aiRows
    };
  });

  const report = {
    app: "rk-bhai-results-portal",
    reportType: "ai-parser-independent-comparison",
    generatedAt: new Date().toISOString(),
    syncCheckedAt: status.checkedAt || null,
    syncStatus: status.status || "unknown",
    note: "Comparison only. AI observations are not counted as independent parser domains and do not change the three-domain publication rule.",
    summary: {
      marketsCompared: comparison.length,
      matches: comparison.filter(row => row.verdict === "MATCH").length,
      conflicts: comparison.filter(row => row.verdict === "CONFLICT").length,
      aiOnly: comparison.filter(row => row.verdict === "AI_ONLY").length,
      parserOnly: comparison.filter(row => row.verdict === "PARSER_ONLY").length,
      noData: comparison.filter(row => row.verdict === "NO_DATA").length
    },
    markets: comparison
  };

  let existingSha;
  try { existingSha = (await readFile("data/ai-parser-comparison-report.json")).sha; }
  catch (error) {
    if (!String(error.message).includes("HTTP 404")) throw error;
  }
  await writeFile("data/ai-parser-comparison-report.json", JSON.stringify(report, null, 2) + "\n", existingSha,
    "Publish separate AI and parser comparison report");
  console.log("AI/Parser comparison report published:", JSON.stringify(report.summary));
}

main().catch(error => {
  console.error("AI/Parser comparison report failed:", error);
  process.exitCode = 1;
});
