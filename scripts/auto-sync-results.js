require("dotenv").config();
const mongoose = require("mongoose");

const SOURCE_URLS = [
  // Preferred sources, in priority order
  "https://kingsofsatta.com/",
  "https://1xsatta.today/",
  "https://gali-results.com/",
  // Backup sources
  "https://satta-king-fast.com/",
  "https://www.satta-king-gali.com/",
  "https://satta-superfast.com/",
  // Additional backup sources (checked only if earlier sources fail validation)
  "https://sattaking.in/chart/gali",
  "https://sattafree.com/",
  "https://sattaking.live/",
  "https://galidisawer.com/"
];
let activeSourceUrl = SOURCE_URLS[0];
const sourceDiagnostics = [];
const REPO = process.env.GITHUB_REPOSITORY || "jasmelsolanki2017-svg/rk-bhai-results-portal-";
const SNAPSHOT_BRANCH = "public-data";
const STATUS_FILE = "data/auto-sync-status.json";
let sourceFetchAttempts = 0;
let sourceHttpStatus = null;
const SOURCE_MARKETS = [
  { source: ["DESAWAR", "DESAWAR", "DISAWAR"], title: "Disawar" },
  { source: ["FARIDABAD"], title: "Faridabad" },
  { source: ["GHAZIABAD"], title: "Ghaziabad" },
  { source: ["GALI"], title: "Gali" },
  { source: ["DELHI BAZAR", "DELHI BAZAR"], title: "Delhi Bazar" },
  { source: ["SHRI GANESH", "SHREE GANESH"], title: "Shree Ganesh" }
];

const Result = mongoose.model("Result", new mongoose.Schema({
  title: String,
  resultText: String,
  resultDate: Date,
  published: Boolean,
  deleted: Boolean,
  sourceUrl: String,
  ownerUserId: mongoose.Schema.Types.ObjectId,
  cityId: mongoose.Schema.Types.ObjectId,
  createdAt: Date
}, { strict: false }));

const City = mongoose.model("PortalCity", new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId,
  cityName: String,
  expectedTime: String,
  status: String
}, { strict: false }));

function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function getIndiaDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date);
  const get = type => parts.find(part => part.type === type)?.value;
  return { year: Number(get("year")), month: Number(get("month")), day: Number(get("day")) };
}

function parseSourceDate(html) {
  const plain = decodeHtml(html.replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " "));
  // Daily pages may show two date columns: today's date first, yesterday's second.
  // Trust the first date in the explicit heading, not merely the presence of a date somewhere.
  const timewise = plain.match(/(?:Timewise\s+)?(?:Superfast\s+)?Satta\s+Kings?\s+Results?\s+of\s+([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})\s*(?:&|and)\s*([A-Za-z]+)\s+(\d{1,2}),?\s*(\d{4})?/i);
  if (timewise) {
    const month = new Date(Date.parse(timewise[1] + " 1, 2000")).getMonth() + 1;
    return { year: Number(timewise[3]), month, day: Number(timewise[2]) };
  }

  // Other source variants use a single-date heading.
  const match = plain.match(/Satta Kings? Fast Results of\s+([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/i);
  if (match) {
    const month = new Date(Date.parse(match[1] + " 1, 2000")).getMonth() + 1;
    return { year: Number(match[3]), month, day: Number(match[2]) };
  }

  // Some versions expose only the monthly chart heading. Accept today's date
  // only when that exact day row exists in the source table.
  const monthly = plain.match(/Monthly Satta King Result Chart of\s+([A-Za-z]+)\s+(\d{4})/i);
  if (monthly) {
    const month = new Date(Date.parse(monthly[1] + " 1, 2000")).getMonth() + 1;
    const today = getIndiaDateParts();
    const rowPattern = new RegExp("(?:^|\s)0?" + today.day + "\s+(?:\d{2}|XX|--|-)(?:\s+(?:\d{2}|XX|--|-)){1,8}(?:\s|$)", "im");
    if (Number(monthly[2]) === today.year && month === today.month && rowPattern.test(plain)) {
      return today;
    }
  }
  throw new Error("Source result date heading/table was not found; refusing to import unverified data.");
}

function parseMarketValues(html, marketNames) {
  const withoutNoise = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, "\n")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "\n");
  const text = decodeHtml(withoutNoise
    .replace(/<\/(h[1-6]|p|div|tr|td|th|li|br|section|article)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/\r/g, "\n")
    .split("\n")
    .map(line => line.replace(/\s+/g, " ").trim().toUpperCase())
    .filter(Boolean);

  const aliases = Array.isArray(marketNames) ? marketNames : [marketNames];
  const normalizedAliases = aliases.map(name => String(name).toUpperCase().replace(/[^A-Z0-9 ]/g, "").trim());
  const start = text.findIndex(line => normalizedAliases.includes(line.replace(/[^A-Z0-9 ]/g, "").trim()));
  if (start < 0) return null;

  const values = [];
  for (let i = start + 1; i < Math.min(text.length, start + 18); i++) {
    const line = text[i];
    if (/^\d{1,2}:\d{2}\s*(AM|PM)?$/.test(line)) continue;
    if (/^(?:\d{2}|XX|--|WAIT|-)$/.test(line)) values.push(line);
    if (values.length >= 2) break;
  }
  if (!values.length) return null;

  // Result tables list the current date column first and the previous date second.
  // Never fall back to yesterday's value when today's cell is --, XX, WAIT, or blank.
  const current = values[0];
  return /^\d{2}$/.test(current) ? current : null;
}


async function publishSyncStatus(status, message) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GitHub Actions token is missing; sync status could not be published.");
  const apiUrl = "https://api.github.com/repos/" + REPO + "/contents/" + STATUS_FILE;
  const headers = {
    Authorization: "Bearer " + token,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  const statusData = {
    app: "rk-bhai-results-portal",
    status,
    message: String(message || "").slice(0, 500),
    sourceUrl: activeSourceUrl,
    sourceDiagnostics,
    attempts: sourceFetchAttempts,
    httpStatus: sourceHttpStatus,
    checkedAt: new Date().toISOString()
  };
  const currentResponse = await fetch(apiUrl + "?ref=" + SNAPSHOT_BRANCH, { headers });
  let sha;
  if (currentResponse.ok) sha = (await currentResponse.json()).sha;
  else if (currentResponse.status !== 404) throw new Error("Sync status lookup failed: HTTP " + currentResponse.status);
  const payload = {
    message: "Update automatic result sync status",
    content: Buffer.from(JSON.stringify(statusData, null, 2) + "\n", "utf8").toString("base64"),
    branch: SNAPSHOT_BRANCH
  };
  if (sha) payload.sha = sha;
  const write = await fetch(apiUrl, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!write.ok) throw new Error("Sync status write failed: HTTP " + write.status + " " + (await write.text()).slice(0, 200));
  console.log("Automatic sync status published:", status);
}

async function fetchSourceHtml() {
  let lastError = null;
  const today = getIndiaDateParts();

  for (const sourceUrl of SOURCE_URLS) {
    activeSourceUrl = sourceUrl;
    sourceFetchAttempts++;
    try {
      console.log("Checking result source:", sourceUrl);
      const response = await fetch(sourceUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml",
          "Accept-Language": "en-IN,en;q=0.9,hi;q=0.8"
        },
        signal: AbortSignal.timeout(12000)
      });
      sourceHttpStatus = response.status;
      if (!response.ok) {
        lastError = new Error("HTTP " + response.status);
        sourceDiagnostics.push({ url: sourceUrl, status: response.status, result: "fetch_failed" });
        console.warn("Source unavailable:", sourceUrl, "HTTP", response.status);
        continue;
      }

      const html = await response.text();
      let sourceDate;
      try {
        sourceDate = parseSourceDate(html);
      } catch (error) {
        lastError = error;
        sourceDiagnostics.push({ url: sourceUrl, status: response.status, result: "date_not_recognized" });
        console.warn("Source date not recognized:", sourceUrl);
        continue;
      }

      if (sourceDate.year !== today.year || sourceDate.month !== today.month || sourceDate.day !== today.day) {
        lastError = new Error("Source page is not dated today (IST)");
        sourceDiagnostics.push({ url: sourceUrl, status: response.status, result: "stale_date", sourceDate });
        console.warn("Source is not showing today's result:", sourceUrl, sourceDate);
        continue;
      }

      const marketResults = {};
      for (const market of SOURCE_MARKETS) {
        const value = parseMarketValues(html, market.source);
        if (value) marketResults[market.title] = value;
      }

      if (!Object.keys(marketResults).length) {
        lastError = new Error("Today's page found, but no market result matched the expected format");
        sourceDiagnostics.push({ url: sourceUrl, status: response.status, result: "format_not_recognized" });
        console.warn("No valid market values parsed from:", sourceUrl);
        continue;
      }

      sourceDiagnostics.push({
        url: sourceUrl, status: response.status, result: "accepted",
        marketsFound: Object.keys(marketResults)
      });
      console.log("Using source:", sourceUrl, "markets found:", Object.keys(marketResults).join(", "));
      return { marketResults, sourceDate };
    } catch (error) {
      lastError = error;
      sourceHttpStatus = null;
      sourceDiagnostics.push({ url: sourceUrl, status: null, result: "request_error", message: error.message });
      console.warn("Source request failed:", sourceUrl, error.message);
    }
  }

  throw new Error("All result sources failed validation. " + (lastError?.message || "No usable source found."));
}

async function updatePublicSnapshot() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GitHub Actions token is missing.");
  const approvedCities = await City.find({ status: "approved" })
    .select("cityName expectedTime").sort({ cityName: 1 }).lean();
  const approvedCityIds = approvedCities.map(city => city._id);
  const filter = {
    published: true,
    deleted: { $ne: true },
    $or: [{ ownerUserId: null }, { ownerUserId: { $exists: false } }, { cityId: { $in: approvedCityIds } }]
  };
  const results = await Result.find(filter)
    .select("title resultText resultDate sourceUrl createdAt")
    .sort({ resultDate: -1, title: 1 }).limit(20000).lean();
  const cityMap = new Map();
  for (const city of approvedCities) {
    cityMap.set(String(city.cityName).trim().toLowerCase(), {
      cityName: city.cityName, expectedTime: city.expectedTime || ""
    });
  }
  for (const row of results) {
    const key = String(row.title || "").trim().toLowerCase();
    if (key && !cityMap.has(key)) cityMap.set(key, { cityName: row.title, expectedTime: "" });
  }
  const snapshot = {
    app: "rk-bhai-results-portal",
    updatedAt: new Date().toISOString(),
    results: results.map(row => ({
      _id: String(row._id), title: row.title, resultText: row.resultText,
      resultDate: row.resultDate, sourceUrl: row.sourceUrl || "", createdAt: row.createdAt || null
    })),
    cities: [...cityMap.values()].sort((a, b) => a.cityName.localeCompare(b.cityName))
  };

  const apiUrl = "https://api.github.com/repos/" + REPO + "/contents/data/public-results.json";
  const headers = {
    Authorization: "Bearer " + token,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  const currentResponse = await fetch(apiUrl + "?ref=" + SNAPSHOT_BRANCH, { headers });
  let sha;
  if (currentResponse.ok) {
    const current = await currentResponse.json();
    sha = current.sha;
    try {
      const oldText = Buffer.from(String(current.content || "").replace(/\n/g, ""), "base64").toString("utf8");
      const old = JSON.parse(oldText);
      if (JSON.stringify({ app: old.app, results: old.results, cities: old.cities }) ===
          JSON.stringify({ app: snapshot.app, results: snapshot.results, cities: snapshot.cities })) {
        console.log("Public snapshot unchanged.");
        return;
      }
    } catch (error) {
      console.warn("Existing snapshot comparison skipped:", error.message);
    }
  } else if (currentResponse.status !== 404) {
    throw new Error("GitHub snapshot lookup failed: HTTP " + currentResponse.status);
  }

  const payload = {
    message: "Auto-sync published results",
    content: Buffer.from(JSON.stringify(snapshot, null, 2) + "\n", "utf8").toString("base64"),
    branch: SNAPSHOT_BRANCH
  };
  if (sha) payload.sha = sha;
  const write = await fetch(apiUrl, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!write.ok) throw new Error("GitHub snapshot write failed: HTTP " + write.status + " " + (await write.text()).slice(0, 300));
  console.log("Public GitHub Pages snapshot updated:", results.length, "records.");
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error("Add MONGODB_URI as a GitHub Actions repository secret.");
  await publishSyncStatus("running", "सोर्स वेबसाइट से रिजल्ट डेटा लिया जा रहा है।");
  const { marketResults, sourceDate } = await fetchSourceHtml();

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  const date = new Date(Date.UTC(sourceDate.year, sourceDate.month - 1, sourceDate.day, 12));
  let insertedOrUpdated = 0;
  for (const market of SOURCE_MARKETS) {
    const resultText = marketResults[market.title];
    if (!resultText) {
      console.log("No published result for", market.title, "- skipped.");
      continue;
    }
    await Result.updateOne(
      { title: market.title, resultDate: { $gte: new Date(Date.UTC(sourceDate.year, sourceDate.month - 1, sourceDate.day)), $lt: new Date(Date.UTC(sourceDate.year, sourceDate.month - 1, sourceDate.day + 1)) } },
      { $set: { title: market.title, resultText, resultDate: date, published: true, deleted: false, sourceUrl: activeSourceUrl, ownerUserId: null, cityId: null }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    );
    insertedOrUpdated++;
    console.log("Synced", market.title, resultText);
  }
  if (insertedOrUpdated) await updatePublicSnapshot();
  else console.log("No new source values found; database and snapshot left unchanged.");
  await publishSyncStatus("success", insertedOrUpdated ? insertedOrUpdated + " मार्केट रिकॉर्ड sync हुए। Source: " + activeSourceUrl : "कोई नया प्रकाशित रिजल्ट नहीं मिला; पुराना डेटा सुरक्षित रखा गया।");
}

main()
  .catch(async error => {
    console.error("Automatic result sync failed:", error);
    try { await publishSyncStatus("failed", error.message || "Automatic result sync failed."); }
    catch (statusError) { console.error("Could not publish sync failure status:", statusError.message); }
    process.exitCode = 1;
  })
  .finally(async () => { if (mongoose.connection.readyState) await mongoose.disconnect(); });
