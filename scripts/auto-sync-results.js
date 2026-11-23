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
  for (let i = 0; i < candidates.length; i++) {
    const match = plain.match(candidates[i]);
    if (!match) continue;
    let found;
    if (i <= 1) found = { year: Number(match[3]), month: monthNumber(match[1]), day: Number(match[2]) };
    else if (i === 2) found = { year: Number(match[3]), month: Number(match[2]), day: Number(match[1]) };
    else found = { year: Number(match[3]), month: monthNumber(match[2]), day: Number(match[1]) };
    if (found.month) return found;
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
function parseMarketValues(html, marketNames) {
  const aliases = Array.isArray(marketNames) ? marketNames : [marketNames];
  const normalize = value => decodeHtml(String(value || ""))
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ")
    .replace(/[^A-Z0-9\u0900-\u097F ]/gi, " ")
    .replace(/\s+/g, " ").trim().toUpperCase();
  const aliasSet = aliases.map(normalize);
  const marketCodes = {
    "DISAWAR": ["DSWR", "DISAWER", "DESAWAR", "DESAWER"],
    "FARIDABAD": ["FRBD"],
    "GHAZIABAD": ["GABD"],
    "GALI": ["GALI"],
    "DELHI BAZAR": ["DLBZ", "DELHI BAZAAR"],
    "SHREE GANESH": ["SRGN", "SHRI GANESH"]
  };
  const codes = (marketCodes[aliasSet[0]] || []).map(normalize);
  const today = getIndiaDateParts();

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
        if (modifiedDate.year !== today.year || modifiedDate.month !== today.month || modifiedDate.day !== today.day) {
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
      if (sourceDate.year !== today.year || sourceDate.month !== today.month || sourceDate.day !== today.day) {
        sourceDiagnostics.push({ pass: passLabel, url: sourceUrl, status: response.status, result: "stale_date", sourceDate });
        return null;
      }
      const marketResults = {};
      for (const market of SOURCE_MARKETS) {
        const value = parseMarketValues(html, market.source);
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
  for (const market of SOURCE_MARKETS) {
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
  if (!process.env.MONGODB_URI) throw new Error("Add MONGODB_URI as a GitHub Actions repository secret.");
  await publishSyncStatus("running", "10 स्रोतों की तारीख और रिजल्ट जाँचे जा रहे हैं; पुष्टि से पहले कुछ प्रकाशित नहीं होगा।");
  const firstPass = await fetchSourceHtml("first_check");
  const first = buildConsensus(firstPass);
  if (!Object.keys(first.consensus).length) {
    await publishSyncStatus("pending", "पहली जाँच में किसी मार्केट के लिए दो अलग डोमेन पर समान रिजल्ट नहीं मिला। पुराना डेटा सुरक्षित है।");
    return;
  }

  console.log("Waiting 150 seconds before independent recheck.");
  await new Promise(resolve => setTimeout(resolve, 150000));
  const secondPass = await fetchSourceHtml("recheck");
  const second = buildConsensus(secondPass);
  const verified = {};
  const pendingMarkets = [];
  for (const market of SOURCE_MARKETS) {
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
    await publishSyncStatus("pending", "दोबारा जाँच में कोई रिजल्ट समान नहीं रहा। कोई डेटा प्रकाशित नहीं किया गया।");
    return;
  }

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  const date = new Date(Date.UTC(getIndiaDateParts().year, getIndiaDateParts().month - 1, getIndiaDateParts().day, 12));
  let insertedOrUpdated = 0;
  const conflicts = [];
  const repeatNumberPending = [];
  for (const market of SOURCE_MARKETS) {
    const evidence = verified[market.title];
    if (!evidence) {
      console.log("Unconfirmed or missing result; left unchanged:", market.title);
      continue;
    }

    // If the same market had the same number yesterday, require three
    // distinct source domains in BOTH checks before accepting today's repeat.
    const previousDate = new Date(date.getTime() - 86400000);
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
        $gte: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())),
        $lt: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1))
      }
    };
    const existing = await Result.findOne(dayFilter).select("resultText").lean();
    if (existing && String(existing.resultText || "").trim() !== evidence.value) {
      conflicts.push(market.title);
      sourceDiagnostics.push({
        result: "same_day_conflict", market: market.title,
        existingValue: existing.resultText, incomingValue: evidence.value,
        candidateSources: evidence.sources
      });
      continue;
    }
    await Result.updateOne(
      dayFilter,
      { $set: {
        title: market.title, resultText: evidence.value, resultDate: date,
        published: true, deleted: false, sourceUrl: evidence.sources.join(", "),
        verificationMeta: evidence, ownerUserId: null, cityId: null
      }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    );
    insertedOrUpdated++;
    console.log("Verified and synced", market.title, evidence.value, "from", evidence.domains.join(", "));
  }
  if (insertedOrUpdated) await updatePublicSnapshot();
  const summary = insertedOrUpdated + " मार्केट रिकॉर्ड दो जाँच और दो अलग डोमेन के मिलान के बाद sync हुए।";
  await publishSyncStatus(conflicts.length || pendingMarkets.length ? "partial" : "success",
    summary + (pendingMarkets.length ? " पुष्टि बाकी: " + pendingMarkets.join(", ") + "." : "") +
    (conflicts.length ? " पुराने रिकॉर्ड से टकराव: " + conflicts.join(", ") + "; पुराने रिकॉर्ड सुरक्षित रखे।" : "") +
    (repeatNumberPending.length ? " लगातार समान नंबर पर तीसरे स्रोत की पुष्टि बाकी: " + repeatNumberPending.join(", ") + "." : ""));
}
main()
  .catch(async error => {
    console.error("Automatic result sync failed:", error);
    try { await publishSyncStatus("failed", error.message || "Automatic result sync failed."); }
    catch (statusError) { console.error("Could not publish sync failure status:", statusError.message); }
    process.exitCode = 1;
  })
  .finally(async () => { if (mongoose.connection.readyState) await mongoose.disconnect(); });
