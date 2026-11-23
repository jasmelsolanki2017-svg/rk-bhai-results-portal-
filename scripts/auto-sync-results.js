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
  { source: ["DESAWER", "DESAWAR", "DISAWAR"], title: "Disawar" },
  { source: ["FARIDABAD"], title: "Faridabad" },
  { source: ["GHAZIABAD"], title: "Ghaziabad" },
  { source: ["GALI"], title: "Gali" },
  { source: ["DELHI BAZAR", "DELHI BAZAR"], title: "Delhi Bazar" },
  { source: ["SHRI GANESH", "SHREE GANESH"], title: "Shree Ganesh" }
];
let RUN_MARKETS = SOURCE_MARKETS;
let cycleResolvedMarkets = new Set();
let cycleHadFirstConsensus = false;
const MARKET_SCHEDULES = {
  "Disawar": "05:00",
  "Faridabad": "18:20",
  "Ghaziabad": "22:05",
  "Gali": "00:05",
  "Delhi Bazar": "15:15",
  "Shree Ganesh": "16:45"
};

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

function getGaliResultDateParts(date = new Date()) {
  const parts = getIndiaDateParts(date);
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hourCycle: "h23" }).format(date));
  // Gali results published from 11:00 PM through 11:59 PM belong to today.
  // From 12:00 AM until 10:59 PM, attribute the result to the previous date.
  if (hour >= 23) return parts;
  const previous = new Date(Date.UTC(parts.year, parts.month - 1, parts.day) - 86400000);
  return { year: previous.getUTCFullYear(), month: previous.getUTCMonth() + 1, day: previous.getUTCDate() };
}
function parseSourceDate(html) {
  const plain = decodeHtml(html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
  ).replace(/\s+/g, " ").trim();
  const today = getIndiaDateParts();
  const monthNames = "January February March April May June July August September October November December".split(" ");
  const monthNumber = name => {
    const index = monthNames.findIndex(month => month.toLowerCase().startsWith(String(name).toLowerCase().slice(0, 3)));
    return index < 0 ? 0 : index + 1;
  };
  const candidates = [
    /(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/i,
    /([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/i,
    /(?:^|\s)(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:\s|$)/,
    /(?:^|\s)(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})(?:\s|$)/
  ];
  let staleDate = null;
  for (let i = 0; i < candidates.length; i++) {
    const match = plain.match(candidates[i]);
    if (!match) continue;
    let found;
    if (i <= 1) found = { year: Number(match[3]), month: monthNumber(match[1]), day: Number(match[2]) };
    else if (i === 2) found = { year: Number(match[3]), month: Number(match[2]), day: Number(match[1]) };
    else found = { year: Number(match[3]), month: monthNumber(match[2]), day: Number(match[1]) };
    const previous = new Date(Date.UTC(today.year, today.month - 1, today.day) - 86400000);
    const isToday = found.year === today.year && found.month === today.month && found.day === today.day;
    const isYesterday = found.year === previous.getUTCFullYear() && found.month === previous.getUTCMonth() + 1 && found.day === previous.getUTCDate();
    if (found.month && (isToday || isYesterday)) return found;
    if (found.month && !staleDate) staleDate = found;
  }

  // Chart-only sites often omit a full date but show the current month and
  // a row for today's day. Require BOTH signals and an explicit live/today section.
  const monthly = plain.match(/(?:monthly chart|complete month chart|daily results by game|record chart|सभी गेम का रिकॉर्ड चार्ट)[^\n]{0,100}?([A-Za-z]+)\s+(\d{4})/i)
    || plain.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i);
  if (monthly) {
    const month = monthNumber(monthly[1]);
    const year = Number(monthly[2]);
    const liveContext = /today|live result|आज के रिजल्ट|आज का रिजल्ट/i.test(plain);
    const dayRow = new RegExp("(?:^|\\s)0?" + today.day + "(?:\\s|\\|)", "im");
    if (year === today.year && month === today.month && liveContext && dayRow.test(plain)) return today;
  }
  throw new Error("Source date not recognized: no current dated heading or current-month chart row.");
}
function parseMarketValues(html, marketNames, targetDay = null) {
  const aliases = Array.isArray(marketNames) ? marketNames : [marketNames];
  const normalize = value => decodeHtml(String(value || ""))
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ")
    .replace(/[^A-Z0-9\u0900-\u097F ]/gi, " ")
    .replace(/\s+/g, " ").trim().toUpperCase();
  const aliasSet = aliases.map(normalize);
  const marketCodes = {
    "DISAWAR": ["DSWR", "DISAWER", "DESAWAR", "DESAWER"],
    "DISAWER": ["DSWR", "DISAWER", "DESAWAR", "DESAWER"],
    "DESAWAR": ["DSWR", "DISAWER", "DESAWAR", "DESAWER"],
    "FARIDABAD": ["FRBD"],
    "GHAZIABAD": ["GABD"],
    "GALI": ["GALI"],
    "DELHI BAZAR": ["DLBZ", "DELHI BAZAAR"],
    "SHREE GANESH": ["SRGN", "SHRI GANESH"],
    "SHRI GANESH": ["SRGN", "SHRI GANESH"]
  };
  const codes = (marketCodes[aliasSet[0]] || []).map(normalize);
  const today = targetDay || getIndiaDateParts();

  // Preferred: read the exact day row from monthly chart tables.
  const tables = [...String(html || "").matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)];
  for (const table of tables) {
    const rows = [...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(row =>
      [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => normalize(cell[1]))
    ).filter(row => row.length > 1);
    if (rows.length < 2) continue;
    const header = rows.find(row => /^(DATE|DAY|तारीख)$/.test(row[0]) || /^(?:NOV|JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|DEC)\s*0?\d{1,2}$/.test(row[0]));
    if (!header) continue;
    let column = header.findIndex((cell, index) => index > 0 && (aliasSet.some(alias => cell.includes(alias)) || codes.some(code => cell === code)));
    if (column < 0) continue;
    const dayRow = rows.find(row => {
      const match = row[0].match(/(?:^|\s)0?(\d{1,2})(?:\s|$)/);
      return match && Number(match[1]) === today.day;
    });
    if (dayRow && dayRow[column] && /^\d{2}$/.test(dayRow[column])) return dayRow[column];
  }

  // Fallback: live "Yesterday / Today" or "कल / आज" result blocks.
  const withoutNoise = String(html || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "\n")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "\n");
  const lines = decodeHtml(withoutNoise
    .replace(/<\/(h[1-6]|p|div|tr|td|th|li|br|section|article)>/gi, "\n")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/\r/g, "\n").split("\n")
    .map(line => line.replace(/\s+/g, " ").trim().toUpperCase()).filter(Boolean);
  const matchesMarket = line => {
    const value = normalize(line);
    return aliasSet.some(alias => value === alias || value.endsWith(alias) || value.startsWith(alias + " "));
  };
  const start = lines.findIndex(matchesMarket);
  if (start < 0) return null;
  let sawToday = false;
  for (let i = start + 1; i < Math.min(lines.length, start + 20); i++) {
    const line = lines[i];
    if (/^(?:TODAY|आज)$/.test(line)) {
      sawToday = true;
      continue;
    }
    if (sawToday) {
      const value = line.match(/(?:^|\s)(\d{2})(?:\s|$)/);
      if (value) return value[1];
      if (/^(?:--|XX|WAIT|PENDING|अभी नहीं)$/.test(line)) return null;
    }
    if (matchesMarket(line)) break;
  }
  return null;
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

async function fetchSourceHtml(passLabel) {
  const today = getIndiaDateParts();
  const galiDate = getGaliResultDateParts();

  // Check all source domains concurrently so a slow/blocked domain cannot
  // consume the whole five-minute schedule window. Each source still fails
  // independently; HTTP 403/timeouts do not stop the remaining sources.
  const observations = await Promise.all(SOURCE_URLS.map(async sourceUrl => {
    sourceFetchAttempts++;
    try {
      console.log("Checking", passLabel, "source:", sourceUrl);
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
        sourceDiagnostics.push({ pass: passLabel, url: sourceUrl, status: response.status, result: "fetch_failed" });
        return null;
      }
      const lastModified = response.headers.get("last-modified");
      if (lastModified) {
        const modifiedDate = getIndiaDateParts(new Date(lastModified));
        const previousModifiedDay = new Date(Date.UTC(today.year, today.month - 1, today.day) - 86400000);
        const modifiedToday = modifiedDate.year === today.year && modifiedDate.month === today.month && modifiedDate.day === today.day;
        const modifiedYesterday = modifiedDate.year === previousModifiedDay.getUTCFullYear() && modifiedDate.month === previousModifiedDay.getUTCMonth() + 1 && modifiedDate.day === previousModifiedDay.getUTCDate();
        if (!modifiedToday && !modifiedYesterday) {
          sourceDiagnostics.push({ pass: passLabel, url: sourceUrl, status: response.status, result: "stale_last_modified", lastModified });
          return null;
        }
      }
      const html = await response.text();
      let sourceDate;
      try { sourceDate = parseSourceDate(html); }
      catch (error) {
        sourceDiagnostics.push({ pass: passLabel, url: sourceUrl, status: response.status, result: "date_not_recognized" });
        return null;
      }
      const previous = new Date(Date.UTC(today.year, today.month - 1, today.day) - 86400000);
      const isCurrentDate = sourceDate.year === today.year && sourceDate.month === today.month && sourceDate.day === today.day;
      const isPreviousDate = sourceDate.year === previous.getUTCFullYear() && sourceDate.month === previous.getUTCMonth() + 1 && sourceDate.day === previous.getUTCDate();
      if (!isCurrentDate && !isPreviousDate) {
        sourceDiagnostics.push({ pass: passLabel, url: sourceUrl, status: response.status, result: "stale_date", sourceDate });
        return null;
      }
      const marketResults = {};
      for (const market of RUN_MARKETS) {
        const value = parseMarketValues(html, market.source, market.title === "Gali" ? galiDate : today);
        if (value) marketResults[market.title] = value;
      }
      sourceDiagnostics.push({
        pass: passLabel, url: sourceUrl, status: response.status,
        result: Object.keys(marketResults).length ? "dated_values_found" : "no_values",
        marketsFound: Object.keys(marketResults)
      });
      if (!Object.keys(marketResults).length) return null;
      return { url: sourceUrl, host: new URL(sourceUrl).hostname.toLowerCase(), sourceDate, lastModified: lastModified || null, marketResults };
    } catch (error) {
      sourceDiagnostics.push({ pass: passLabel, url: sourceUrl, status: null, result: "request_error", message: error.message });
      return null;
    }
  }));

  return observations.filter(Boolean);
}

function buildConsensus(observations) {
  const consensus = {};
  const pending = {};
  for (const market of RUN_MARKETS) {
    const votes = new Map();
    for (const source of observations) {
      const value = source.marketResults[market.title];
      if (!value) continue;
      if (!votes.has(value)) votes.set(value, new Map());
      votes.get(value).set(source.host, source.url);
    }
    const ranked = [...votes.entries()].sort((a, b) => b[1].size - a[1].size);
    const winner = ranked[0];
    if (winner && winner[1].size >= 2 && (!ranked[1] || ranked[1][1].size < 2)) {
      consensus[market.title] = {
        value: winner[0],
        sources: [...winner[1].values()],
        domains: [...winner[1].keys()]
      };
    } else {
      pending[market.title] = ranked.map(([value, hosts]) => ({ value, sources: [...hosts.values()] }));
    }
  }
  return { consensus, pending };
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
    .select("title resultText resultDate sourceUrl verificationMeta createdAt")
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
      resultDate: row.resultDate, sourceUrl: row.sourceUrl || "", verificationMeta: row.verificationMeta || null, createdAt: row.createdAt || null
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
  cycleResolvedMarkets = new Set();
  cycleHadFirstConsensus = false;
  if (!process.env.MONGODB_URI) throw new Error("Add MONGODB_URI as a GitHub Actions repository secret.");
  console.log("Smart Auto Sync cycle:", RUN_MARKETS.map(m => m.title).join(", "));
  const firstPass = await fetchSourceHtml("first_check");
  const first = buildConsensus(firstPass);
  if (!Object.keys(first.consensus).length) {
    console.log("No two-domain consensus in first pass; market will be checked again.");
    return;
  }

  cycleHadFirstConsensus = true;
  console.log("Waiting 30 seconds before independent recheck.");
  await new Promise(resolve => setTimeout(resolve, 30000));
  const secondPass = await fetchSourceHtml("recheck");
  const second = buildConsensus(secondPass);
  const verified = {};
  const pendingMarkets = [];
  for (const market of RUN_MARKETS) {
    const a = first.consensus[market.title];
    const b = second.consensus[market.title];
    if (a && b && a.value === b.value) {
      const combined = [...new Set([...a.sources, ...b.sources])];
      const domains = [...new Set(combined.map(url => new URL(url).hostname.toLowerCase()))];
      if (domains.length >= 2) {
        verified[market.title] = {
          value: a.value, sources: combined, domains,
          checkedAt: new Date().toISOString(),
          firstPassDomains: a.domains, recheckDomains: b.domains,
          rule: "same_value_on_two_distinct_domains_in_two_checks"
        };
        continue;
      }
    }
    if (a || b) pendingMarkets.push(market.title);
  }

  if (!Object.keys(verified).length) {
    console.log("No matching independent recheck; market will be checked again.");
    return;
  }

  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  }
  const indiaToday = getIndiaDateParts();
  const galiResultDay = getGaliResultDateParts();
  const date = new Date(Date.UTC(indiaToday.year, indiaToday.month - 1, indiaToday.day, 12));
  let insertedOrUpdated = 0;
  const conflicts = [];
  const repeatNumberPending = [];
  for (const market of RUN_MARKETS) {
    const evidence = verified[market.title];
    const marketDate = market.title === "Gali" ? new Date(Date.UTC(galiResultDay.year, galiResultDay.month - 1, galiResultDay.day, 12)) : date;
    if (!evidence) {
      console.log("Unconfirmed or missing result; left unchanged:", market.title);
      continue;
    }

    // If the same market had the same number yesterday, require three
    // distinct source domains in BOTH checks before accepting today's repeat.
    const previousDate = new Date(marketDate.getTime() - 86400000);
    const previousDayFilter = {
      title: market.title,
      resultDate: {
        $gte: new Date(Date.UTC(previousDate.getUTCFullYear(), previousDate.getUTCMonth(), previousDate.getUTCDate())),
        $lt: new Date(Date.UTC(previousDate.getUTCFullYear(), previousDate.getUTCMonth(), previousDate.getUTCDate() + 1))
      }
    };
    const previousRecord = await Result.findOne(previousDayFilter).select("resultText").lean();
    const firstEvidence = first.consensus[market.title];
    const secondEvidence = second.consensus[market.title];
    if (previousRecord && String(previousRecord.resultText || "").trim() === evidence.value &&
        (!firstEvidence || firstEvidence.domains.length < 3 || !secondEvidence || secondEvidence.domains.length < 3)) {
      repeatNumberPending.push(market.title);
      console.log("Repeated number needs a third independent source in both checks; left unchanged:", market.title, evidence.value);
      continue;
    }

    const dayFilter = {
      title: market.title,
      resultDate: {
        $gte: new Date(Date.UTC(marketDate.getUTCFullYear(), marketDate.getUTCMonth(), marketDate.getUTCDate())),
        $lt: new Date(Date.UTC(marketDate.getUTCFullYear(), marketDate.getUTCMonth(), marketDate.getUTCDate() + 1))
      }
    };
    const existing = await Result.findOne(dayFilter)
      .select("resultText resultSource sourceUrl syncReview")
      .sort({ createdAt: -1 })
      .lean();
    if (existing) {
      const existingValue = String(existing.resultText || "").trim();
      // Legacy records without resultSource are manual unless they carry an auto-source URL.
      const isManual = existing.resultSource === "manual" ||
        (!existing.resultSource && !String(existing.sourceUrl || "").trim());
      if (existingValue === evidence.value) {
        sourceDiagnostics.push({
          result: isManual ? "manual_match" : "already_matches",
          market: market.title, existingValue, incomingValue: evidence.value,
          candidateSources: evidence.sources
        });
        insertedOrUpdated++;
        cycleResolvedMarkets.add(market.title);
        console.log(isManual ? "Manual result already matches verified source; preserved:" : "Already matches verified source:", market.title, evidence.value);
        continue;
      }
      if (isManual) {
        const priorReview = existing.syncReview;
        if (priorReview && priorReview.automaticValue === evidence.value &&
            ["manual", "automatic"].includes(priorReview.choice)) {
          sourceDiagnostics.push({
            result: "manual_conflict_reviewed", market: market.title,
            existingValue, incomingValue: evidence.value,
            decision: priorReview.choice, candidateSources: evidence.sources
          });
          cycleResolvedMarkets.add(market.title);
          console.log("Previously reviewed manual/automatic difference; keeping admin decision:", market.title, priorReview.choice);
          continue;
        }
        conflicts.push(market.title);
        sourceDiagnostics.push({
          result: "manual_result_protected", market: market.title,
          resultDate: marketDate.toISOString(), existingValue, incomingValue: evidence.value,
          candidateSources: evidence.sources
        });
        cycleResolvedMarkets.add(market.title);
        console.log("Manual result differs from verified sources; preserved for admin review:", market.title, existingValue, evidence.value);
        continue;
      }
      conflicts.push(market.title);
      cycleResolvedMarkets.add(market.title);
      sourceDiagnostics.push({
        result: "same_day_conflict", market: market.title,
        existingValue, incomingValue: evidence.value,
        candidateSources: evidence.sources
      });
      continue;
    }
    await Result.updateOne(
      dayFilter,
      { $set: {
        title: market.title, resultText: evidence.value, resultDate: marketDate,
        published: true, deleted: false, sourceUrl: evidence.sources.join(", "),
        resultSource: "automatic", verificationMeta: evidence,
        ownerUserId: null, cityId: null
      }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    );
    insertedOrUpdated++;
    cycleResolvedMarkets.add(market.title);
    console.log("Verified and synced", market.title, evidence.value, "from", evidence.domains.join(", "));
  }
  if (insertedOrUpdated) await updatePublicSnapshot();
  const summary = insertedOrUpdated + " मार्केट रिकॉर्ड दो जाँच और दो अलग डोमेन के मिलान के बाद sync हुए।";
  console.log(summary + (pendingMarkets.length ? " पुष्टि बाकी: " + pendingMarkets.join(", ") + "." : "") +
    (conflicts.length ? " पुराने रिकॉर्ड से टकराव: " + conflicts.join(", ") + "; पुराने रिकॉर्ड सुरक्षित रखे।" : "") +
    (repeatNumberPending.length ? " लगातार समान नंबर पर तीसरे स्रोत की पुष्टि बाकी: " + repeatNumberPending.join(", ") + "." : ""));
}
function getSmartSyncWindow(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).format(date).split(":").map(Number);
  const nowMinutes = parts[0] * 60 + parts[1];
  const due = [];
  for (const market of SOURCE_MARKETS) {
    const [hour, minute] = MARKET_SCHEDULES[market.title].split(":").map(Number);
    const scheduled = hour * 60 + minute;
    const elapsed = (nowMinutes - scheduled + 1440) % 1440;
    // Start five minutes before the published time; keep checking for up to 180 minutes after it.
    if (elapsed <= 180 || elapsed >= 1435) due.push({ market, elapsed });
  }
  return due;
}

async function smartMain() {
  if (!process.env.MONGODB_URI) throw new Error("Add MONGODB_URI as a GitHub Actions repository secret.");
  const due = getSmartSyncWindow();
  if (!due.length) {
    console.log("Smart Auto Sync: no market is inside its result window; skipping source requests.");
    return;
  }

  let remaining = due.map(item => item.market);
  const seenMarkets = new Set(remaining.map(market => market.title));
  const checkedMarkets = new Set(seenMarkets);
  const startedAt = Date.now();
  const maxRuntimeMs = 185 * 60 * 1000;
  await publishSyncStatus("running",
    "Smart Auto Sync चालू: " + remaining.map(m => m.title).join(", ") +
    " — तय समय से 5 मिनट पहले शुरू, पुष्टि होने तक लगभग हर मिनट जाँच। Chandigarh City मैनुअल है।");

  while (Date.now() - startedAt < maxRuntimeMs) {
    // Add markets whose result windows begin while this worker is already running.
    for (const item of getSmartSyncWindow()) {
      if (!seenMarkets.has(item.market.title)) {
        seenMarkets.add(item.market.title);
        remaining.push(item.market);
        console.log("New market window entered; added to live sync:", item.market.title);
      }
    }
    if (!remaining.length) break;

    RUN_MARKETS = remaining;
    await main();
    remaining = remaining.filter(market => !cycleResolvedMarkets.has(market.title));
    if (remaining.length) {
      console.log("Still waiting for:", remaining.map(m => m.title).join(", "));
      await new Promise(resolve => setTimeout(resolve, cycleHadFirstConsensus ? 15000 : 45000));
    }
  }

  RUN_MARKETS = SOURCE_MARKETS;
  if (remaining.length) {
    await publishSyncStatus("pending",
      "इस बार तय जाँच अवधि में पुष्टि नहीं मिली: " + remaining.map(m => m.title).join(", ") +
      "। अगली cron-job.org जाँच में फिर प्रयास होगा; पुराना डेटा सुरक्षित है।");
  } else {
    await publishSyncStatus("success",
      "Smart Auto Sync ने पुष्टि के बाद रिजल्ट जाँच पूरी कर दी। जाँचे गए मार्केट: " +
      [...checkedMarkets].join(", ") + "।");
  }
}

smartMain()
  .catch(async error => {
    console.error("Automatic result sync failed:", error);
    try { await publishSyncStatus("failed", error.message || "Automatic result sync failed."); }
    catch (statusError) { console.error("Could not publish sync failure status:", statusError.message); }
    process.exitCode = 1;
  })
  .finally(async () => { if (mongoose.connection.readyState) await mongoose.disconnect(); });
