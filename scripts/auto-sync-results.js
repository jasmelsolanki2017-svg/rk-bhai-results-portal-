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
    /(?:^|\s)(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})(?:\s|$)/,
    /(?:आज|कल)?[:：]?\s*(\d{1,2})\s+(जनवरी|फरवरी|मार्च|अप्रैल|मई|जून|जुलाई|अगस्त|सितंबर|अक्टूबर|नवंबर|दिसंबर)\s+(\d{4})/
  ];
  let staleDate = null;
  for (let i = 0; i < candidates.length; i++) {
    const match = plain.match(candidates[i]);
    if (!match) continue;
    let found;
    if (i <= 1) found = { year: Number(match[3]), month: monthNumber(match[1]), day: Number(match[2]) };
    else if (i === 2) found = { year: Number(match[3]), month: Number(match[2]), day: Number(match[1]) };
    else if (i === 3) found = { year: Number(match[3]), month: monthNumber(match[2]), day: Number(match[1]) };
    else {
      const hindiMonths = { "जनवरी":1, "फरवरी":2, "मार्च":3, "अप्रैल":4, "मई":5, "जून":6, "जुलाई":7, "अगस्त":8, "सितंबर":9, "अक्टूबर":10, "नवंबर":11, "दिसंबर":12 };
      found = { year: Number(match[3]), month: hindiMonths[match[2]], day: Number(match[1]) };
    }
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
function parseSourceSpecificMarketValue(html, sourceUrl, market, targetDay) {
  const normalize = value => decodeHtml(String(value || ""))
    .replace(/<[^>]+>/g, " ")
    .replace(/[^A-Z0-9\u0900-\u097F ]/gi, " ")
    .replace(/\s+/g, " ").trim().toUpperCase();
  const aliases = (market.source || []).map(normalize).filter(Boolean);
  const today = getIndiaDateParts();
  const previous = new Date(Date.UTC(today.year, today.month - 1, today.day) - 86400000);
  const isTargetToday = targetDay.year === today.year && targetDay.month === today.month && targetDay.day === today.day;
  const isTargetYesterday = targetDay.year === previous.getUTCFullYear() &&
    targetDay.month === previous.getUTCMonth() + 1 && targetDay.day === previous.getUTCDate();
  if (!isTargetToday && !isTargetYesterday) return null;

  const cellsFromRow = row => [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
    .map(match => normalize(match[1]));

  // Keep header and candidate rows inside the SAME HTML table. Previously
  // all page rows were flattened together, allowing a later market/chart
  // table to be interpreted using an earlier Game/Yesterday/Today header.
  const tables = [...String(html || "").matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)];
  for (const table of tables) {
    const rows = [...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
      .map(match => cellsFromRow(match[1])).filter(row => row.length >= 3);
    for (let h = 0; h < rows.length; h++) {
      const header = rows[h];
      const yesterdayCol = header.findIndex(cell => /^(YESTERDAY|KAL|KAL KA RESULT|कल)$/.test(cell));
      const todayCol = header.findIndex(cell => /^(TODAY|AAJ|AAJ KA RESULT|आज)$/.test(cell));
      const resultCol = isTargetToday ? todayCol : yesterdayCol;
      if (resultCol < 0) continue;
      const gameCol = header.findIndex((cell, index) => index !== resultCol &&
        /^(GAME|MARKET|RESULT|KHEL|गेम)$/.test(cell));
      if (gameCol < 0) continue;
      const matches = [];
      for (let r = h + 1; r < rows.length; r++) {
        const row = rows[r];
        if (row.length <= Math.max(gameCol, resultCol)) continue;
        const game = row[gameCol];
        if (!aliases.some(alias => game === alias || game.startsWith(alias + " ") || game.includes(" " + alias + " "))) continue;
        const value = row[resultCol];
        if (/^\d{2}$/.test(value)) matches.push(value);
      }
      const unique = [...new Set(matches)];
      if (unique.length === 1) return unique[0];
      if (unique.length > 1) return null;
    }
  }

  const textLines = decodeHtml(String(html || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(?:div|section|article|li|tr|h[1-6]|p|header|footer)>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .split(/\r?\n/)
    .map(line => normalize(line))
    .filter(Boolean);
  const allAliases = SOURCE_MARKETS.flatMap(item => item.source.map(normalize));
  const marketLine = line => aliases.some(alias =>
    line === alias || line.startsWith(alias + " ") || line.startsWith(alias + ":") || line.startsWith(alias + "-"));
  const otherMarketLine = line => allAliases.some(alias =>
    !aliases.includes(alias) && (line === alias || line.startsWith(alias + " ") || line.startsWith(alias + ":") || line.startsWith(alias + "-")));
  const labelPattern = isTargetToday ? /^(TODAY|AAJ|आज)(?:\s|$|:)/ : /^(YESTERDAY|KAL|कल)(?:\s|$|:)/;
  for (let i = 0; i < textLines.length; i++) {
    if (!marketLine(textLines[i])) continue;
    for (let j = i + 1; j < Math.min(textLines.length, i + 30); j++) {
      if (otherMarketLine(textLines[j])) break;
      if (!labelPattern.test(textLines[j])) continue;
      for (let k = j + 1; k <= Math.min(textLines.length - 1, j + 4); k++) {
        if (/^\d{2}$/.test(textLines[k])) return textLines[k];
        if (/^(--|—|–|PENDING|ABHI NAHI|अभी नहीं)/.test(textLines[k])) break;
      }
    }
  }
  return null;
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
    const header = rows.find(row => /^(DATE|DAY|तारीख)$/.test(row[0]) || /^(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s*0?\d{1,2}$/.test(row[0]));
    if (!header) continue;
    const currentMonth = new Intl.DateTimeFormat("en", { timeZone: "Asia/Kolkata", month: "short" }).format(new Date()).toUpperCase();
    const headerMonth = header[0].match(/^[A-Z]{3}/)?.[0];
    if (headerMonth && headerMonth !== currentMonth) continue;
    const column = header.findIndex((cell, index) => index > 0 &&
      (aliasSet.some(alias => cell === alias || cell.includes(alias)) || codes.some(code => cell === code)));
    if (column < 0) continue;
    const dayRow = rows.find(row => {
      const firstCell = row[0].replace(/[^A-Z0-9 ]/g, " ").trim();
      const match = firstCell.match(/^(?:[A-Z]{3}\s*)?0?(\d{1,2})$/);
      return match && Number(match[1]) === today.day;
    });
    // Only accept a two-digit result from the exact current-day row.
    if (dayRow && dayRow[column] && /^\d{2}$/.test(dayRow[column])) return dayRow[column];
  }

  // Safety: do not scrape loosely-associated live text blocks. Only a value
  // from the exact current-date row and the exact market column is acceptable.
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
        signal: AbortSignal.timeout(8000)
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
      const marketParsers = {};
      for (const market of RUN_MARKETS) {
        const targetDay = market.title === "Gali" ? galiDate : today;
        // First choice: exact date row + exact market column in monthly charts.
        let value = parseMarketValues(html, market.source, targetDay);
        if (value) {
          marketResults[market.title] = value;
          marketParsers[market.title] = "exact_date_monthly_chart";
          continue;
        }
        // Safe fallback: explicit HTML table with Game/Market + Today/Yesterday
        // headers. The market name and result must be cells in the SAME row.
        // No nearby-line/proximity scanning is allowed.
        value = parseSourceSpecificMarketValue(html, sourceUrl, market, targetDay);
        if (value) {
          marketResults[market.title] = value;
          marketParsers[market.title] = "same_row_explicit_today_yesterday_table";
        }
      }

      // Safety guard: one source must not accidentally assign the same parsed
      // cell/value to multiple markets. This previously caused false positives
      // when a page's chart columns or live-result blocks were misidentified.
      // Treat every repeated value within one source as ambiguous and do not
      // let that source vote for any of the affected markets.
      const valueMarkets = new Map();
      for (const [marketName, value] of Object.entries(marketResults)) {
        if (!valueMarkets.has(value)) valueMarkets.set(value, []);
        valueMarkets.get(value).push(marketName);
      }
      const ambiguousValues = [];
      for (const [value, markets] of valueMarkets.entries()) {
        if (markets.length > 1) {
          ambiguousValues.push({ value, markets });
          for (const marketName of markets) delete marketResults[marketName];
        }
      }
      sourceDiagnostics.push({
        pass: passLabel, url: sourceUrl, status: response.status,
        result: Object.keys(marketResults).length ? "dated_values_found" :
          (ambiguousValues.length ? "ambiguous_duplicate_values" : "no_values"),
        marketsFound: Object.keys(marketResults),
        marketValues: marketResults,
        marketParsers,
        ambiguousValues,
        parser: Object.keys(marketResults).length ? "exact_date_monthly_chart_or_same_row_dated_table" : "no_exact_date_market_cell_or_same_row_dated_table"
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
  console.log("Waiting 8 seconds before independent recheck.");
  await new Promise(resolve => setTimeout(resolve, 8000));
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
async function runOnce() {
  RUN_MARKETS = SOURCE_MARKETS;
  cycleResolvedMarkets = new Set();
  cycleHadFirstConsensus = false;
  await publishSyncStatus("running", "सामान्य Automatic Result Sync जाँच चालू है। सभी स्वचालित मार्केट जाँचे जा रहे हैं; अगली जाँच cron-job.org से हर 5 मिनट में होगी। Chandigarh City मैनुअल है।");
  try {
    await main();
    await publishSyncStatus("success", "इस चक्र की सामान्य Automatic Result Sync जाँच पूरी हुई। जिन मार्केट का दो स्वतंत्र जाँचों में मिलान नहीं हुआ, उनका पुराना रिकॉर्ड सुरक्षित है।");
  } catch (error) {
    await publishSyncStatus("failed", error.message || "Automatic result sync failed.");
    throw error;
  }
}

runOnce()
  .catch(error => {
    console.error("Automatic result sync failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => { if (mongoose.connection.readyState) await mongoose.disconnect(); });
