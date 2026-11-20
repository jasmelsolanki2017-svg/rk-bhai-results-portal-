require("dotenv").config();
const mongoose = require("mongoose");

const REPO = process.env.GITHUB_REPOSITORY || "jasmelsolanki2017-svg/rk-bhai-results-portal-";
const SNAPSHOT_BRANCH = "public-data";
const SOURCE_HOST = "https://www.satta-klng.com";
const MARKETS = ["Disawar", "Delhi Bazar", "Shree Ganesh", "Faridabad", "Ghaziabad", "Gali"];
const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];

const Result = mongoose.model("Result", new mongoose.Schema({
  title: String, resultText: String, resultDate: Date, published: Boolean, deleted: Boolean,
  sourceUrl: String, ownerUserId: mongoose.Schema.Types.ObjectId,
  cityId: mongoose.Schema.Types.ObjectId, createdAt: Date
}, { strict: false }));

const City = mongoose.model("PortalCity", new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId, cityName: String, expectedTime: String, status: String
}, { strict: false }));

function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function cellText(html) {
  return decodeHtml(html.replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function parseMonth(html, year, month, sourceUrl) {
  const rows = [];
  const rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowPattern.exec(html))) {
    const cells = [];
    const cellPattern = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch;
    while ((cellMatch = cellPattern.exec(rowMatch[1]))) cells.push(cellText(cellMatch[1]));
    if (cells.length < 7) continue;
    const dateMatch = cells[0].match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (!dateMatch) continue;
    const day = Number(dateMatch[1]);
    const rowMonth = Number(dateMatch[2]);
    const rowYear = Number(dateMatch[3]);
    if (rowYear !== year || rowMonth !== month || day < 1 || day > 31) continue;
    for (let i = 0; i < MARKETS.length; i++) {
      const value = String(cells[i + 1] || "").trim();
      if (!/^\d{2}$/.test(value)) continue;
      rows.push({
        title: MARKETS[i],
        resultText: value,
        resultDate: new Date(Date.UTC(year, month - 1, day)),
        published: true,
        deleted: false,
        sourceUrl,
        ownerUserId: null,
        cityId: null,
        createdAt: new Date()
      });
    }
  }
  return rows;
}

async function fetchMonth(year, month) {
  const slug = MONTHS[month - 1] + "-" + year;
  const url = SOURCE_HOST + "/satta-king-result-of-" + slug;
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; RKBhaiHistoricalArchive/1.0)" },
    signal: AbortSignal.timeout(25000)
  });
  if (response.status === 404) {
    console.log("Archive month not found; skipped:", slug);
    return [];
  }
  if (!response.ok) throw new Error("Source failed for " + slug + ": HTTP " + response.status);
  const html = await response.text();
  const rows = parseMonth(html, year, month, url);
  if (!rows.length && !/All Games/i.test(html)) {
    throw new Error("Could not verify the archive table for " + slug + "; refusing to import.");
  }
  console.log(slug + ": parsed " + rows.length + " declared results.");
  return rows;
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
  for (const city of approvedCities) cityMap.set(String(city.cityName).trim().toLowerCase(), {
    cityName: city.cityName, expectedTime: city.expectedTime || ""
  });
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
    Authorization: "Bearer " + token, Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  const currentResponse = await fetch(apiUrl + "?ref=" + SNAPSHOT_BRANCH, { headers });
  let sha;
  if (currentResponse.ok) {
    const current = await currentResponse.json();
    sha = current.sha;
  } else if (currentResponse.status !== 404) {
    throw new Error("GitHub snapshot lookup failed: HTTP " + currentResponse.status);
  }
  const payload = {
    message: "Import verified historical results archive",
    content: Buffer.from(JSON.stringify(snapshot, null, 2) + "\n", "utf8").toString("base64"),
    branch: SNAPSHOT_BRANCH
  };
  if (sha) payload.sha = sha;
  const write = await fetch(apiUrl, {
    method: "PUT", headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!write.ok) throw new Error("GitHub snapshot write failed: HTTP " + write.status + " " + (await write.text()).slice(0, 500));
  console.log("Published static snapshot with", results.length, "records.");
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI secret is missing.");
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  let sourceRows = [];
  for (let year = 2020; year <= 2026; year++) {
    const firstMonth = year === 2020 ? 2 : 1;
    const lastMonth = year === 2026 ? 11 : 12;
    for (let month = firstMonth; month <= lastMonth; month++) {
      sourceRows.push(...await fetchMonth(year, month));
      await new Promise(resolve => setTimeout(resolve, 180));
    }
  }
  if (!sourceRows.length) throw new Error("No historical results were parsed; nothing was changed.");
  let upserted = 0;
  for (let offset = 0; offset < sourceRows.length; offset += 400) {
    const chunk = sourceRows.slice(offset, offset + 400);
    const operations = chunk.map(row => {
      const start = row.resultDate;
      const end = new Date(start.getTime() + 86400000);
      return {
        updateOne: {
          filter: { title: row.title, resultDate: { $gte: start, $lt: end } },
          update: { $setOnInsert: row },
          upsert: true
        }
      };
    });
    const result = await Result.bulkWrite(operations, { ordered: false });
    upserted += result.upsertedCount || 0;
  }
  console.log("Verified archive rows:", sourceRows.length, "| New database records:", upserted);
  await updatePublicSnapshot();
}

main()
  .catch(error => { console.error("Historical import failed:", error); process.exitCode = 1; })
  .finally(async () => { if (mongoose.connection.readyState) await mongoose.disconnect(); });
