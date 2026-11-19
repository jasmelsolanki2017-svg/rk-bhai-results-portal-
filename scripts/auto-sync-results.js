require("dotenv").config();
const mongoose = require("mongoose");

const SOURCE_URL = "https://satta-king-fast.com/";
const REPO = process.env.GITHUB_REPOSITORY || "jasmelsolanki2017-svg/rk-bhai-results-portal-";
const SNAPSHOT_BRANCH = "public-data";
const SOURCE_MARKETS = [
  { source: "DESAWAR", title: "Disawar" },
  { source: "FARIDABAD", title: "Faridabad" },
  { source: "GHAZIABAD", title: "Ghaziabad" },
  { source: "GALI", title: "Gali" },
  { source: "DELHI BAZAR", title: "Delhi Bazar" },
  { source: "SHRI GANESH", title: "Shree Ganesh" }
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
  const match = plain.match(/Satta King Fast Results of\s+([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/i);
  if (!match) throw new Error("Source result date heading was not found; refusing to import unverified data.");
  const month = new Date(Date.parse(match[1] + " 1, 2000")).getMonth() + 1;
  return { year: Number(match[3]), month, day: Number(match[2]) };
}

function parseMarketValues(html, marketName) {
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

  const start = text.findIndex(line => line === marketName || line.replace(/[^A-Z0-9 ]/g, "").trim() === marketName);
  if (start < 0) return null;

  const values = [];
  for (let i = start + 1; i < Math.min(text.length, start + 18); i++) {
    const line = text[i];
    if (/^\d{1,2}:\d{2}\s*(AM|PM)?$/.test(line)) continue;
    if (/^(?:\d{2}|XX|--|WAIT|-)$/.test(line)) values.push(line);
    if (values.length >= 2) break;
  }
  if (values.length < 2) return null;
  const current = values[1];
  return /^\d{2}$/.test(current) ? current : null;
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
  const response = await fetch(SOURCE_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; RKBhaiResultsSync/1.0)" },
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error("Source website returned HTTP " + response.status);
  const html = await response.text();
  const sourceDate = parseSourceDate(html);
  const today = getIndiaDateParts();
  if (sourceDate.year !== today.year || sourceDate.month !== today.month || sourceDate.day !== today.day) {
    console.log("Source page is not dated today (IST); no results imported. Source date:", sourceDate);
    return;
  }

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  const date = new Date(Date.UTC(sourceDate.year, sourceDate.month - 1, sourceDate.day, 12));
  let insertedOrUpdated = 0;
  for (const market of SOURCE_MARKETS) {
    const resultText = parseMarketValues(html, market.source);
    if (!resultText) {
      console.log("No published result for", market.title, "- skipped.");
      continue;
    }
    await Result.updateOne(
      { title: market.title, resultDate: { $gte: new Date(Date.UTC(sourceDate.year, sourceDate.month - 1, sourceDate.day)), $lt: new Date(Date.UTC(sourceDate.year, sourceDate.month - 1, sourceDate.day + 1)) } },
      { $set: { title: market.title, resultText, resultDate: date, published: true, deleted: false, sourceUrl: SOURCE_URL, ownerUserId: null, cityId: null }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    );
    insertedOrUpdated++;
    console.log("Synced", market.title, resultText);
  }
  if (insertedOrUpdated) await updatePublicSnapshot();
  else console.log("No new source values found; database and snapshot left unchanged.");
}

main()
  .catch(error => { console.error("Automatic result sync failed:", error); process.exitCode = 1; })
  .finally(async () => { if (mongoose.connection.readyState) await mongoose.disconnect(); });
