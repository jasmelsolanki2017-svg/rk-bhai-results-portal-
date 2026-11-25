require("dotenv").config();
const mongoose = require("mongoose");

const SOURCE_URLS = [
  // Priority sources: checked first; they still need independent-site consensus.
  "https://kingsofsatta.com/",
  "https://satta-king-gali.com/",
  "https://sattafree.com/",
  "https://galidisawer.com/",
  // Other sources
  "https://1xsatta.today/",
  "https://satta-king-fast.com/",
  "https://satta-superfast.com/",
  "https://sattaking.live/",
  // Verified direct monthly chart pages / result pages
  "https://satta.live/record_chart/disawar_record_chart.php",
  "https://www.realsattaking.com/",
  "https://www.faridabadlucky.com/chart/new-disawar/" + new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit" }).format(new Date()),
  "https://www.delhilucky.com/chart/new-disawar/" + new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit" }).format(new Date()) + "?lang=hi",
  "https://satta-fast.com/satta-king-chart-" + new Intl.DateTimeFormat("en", { timeZone: "Asia/Kolkata", month: "long" }).format(new Date()).toLowerCase() + "-" + getIndiaDateParts().year,
  "https://1xsatta.today/record-chart/disawar/",
  "https://1xsatta.today/record-chart/shri-ganesh/",
  "https://1xsatta.today/record-chart/faridabad/",
  "https://1xsatta.today/record-chart/ghaziabad/",
  "https://1xsatta.today/record-chart/gali/",
  "https://sattafree.com/game-history.php?game=shree-ganesh"
];
let activeSourceUrl = SOURCE_URLS[0];
// DeepSeek AI fallback is restricted to the 1xsatta.today homepage only.
// Its dedicated chart pages and every other source remain parser-only.
const AI_ALLOWED_HOSTS = new Set(["1xsatta.today", "www.1xsatta.today"]);
// Coarena allows only two in-flight requests per account. Serialize DeepSeek calls
// across concurrently fetched 1xsatta.today pages to avoid HTTP 429 concurrency errors.
let deepSeekRequestQueue = Promise.resolve();
function runDeepSeekSequentially(task) {
  const current = deepSeekRequestQueue.then(task, task);
  deepSeekRequestQueue = current.catch(() => {});
  return current;
}
const sourceDiagnostics = [];
const REPO = process.env.GITHUB_REPOSITORY || "jasmelsolanki2017-svg/rk-bhai-results-portal-";
const SNAPSHOT_BRANCH = "public-data";
const STATUS_FILE = "data/auto-sync-status.json";
let sourceFetchAttempts = 0;
let sourceHttpStatus = null;
const SOURCE_MARKETS = [
  { source: ["DESAWER", "DESAWAR", "DISAWAR", "DISAWER", "DSWR", "दिसावर"], title: "Disawar" },
  { source: ["FARIDABAD", "FRBD", "फरीदाबाद"], title: "Faridabad" },
  { source: ["GHAZIABAD", "GZBD", "GB", "गाजियाबाद", "गाज़ियाबाद"], title: "Ghaziabad" },
  { source: ["GALI", "GL", "गली"], title: "Gali" },
  { source: ["DELHI BAZAR", "DELHI BAZAAR", "DLBZ", "DB", "दिल्ली बाजार"], title: "Delhi Bazar" },
  { source: ["SHRI GANESH", "SHREE GANESH", "SRGN", "SG", "श्री गणेश"], title: "Shree Ganesh" }
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
    /([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/i,
    /(?:^|\s)(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:\s|$)/,
    /(?:^|\s)(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})(?:\s|$)/,
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

  // Chart-only pages may have no "today/live" label. Accept them only when
  // the page explicitly names the current month/year AND an HTML table has a
  // DATE/DAY header with an exact row for today's day.
  const monthly = plain.match(/(?:monthly chart|complete month chart|daily results by game|record chart|सभी गेम का रिकॉर्ड चार्ट)[^\n]{0,100}?([A-Za-z]+)\s+(\d{4})/i)
    || plain.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{4})\b/i);
  if (monthly) {
    const month = monthNumber(monthly[1]);
    const year = Number(monthly[2]);
    const hasExactTodayRow = [...String(html || "").matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].some(table => {
      const rows = [...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(row =>
        [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell =>
          decodeHtml(cell[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().toUpperCase()
        )
      );
      const hasDateHeader = rows.some(row =>
        /^(DATE|DAY|तारीख)$/.test(row[0] || "") ||
        /^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s*0?\d{1,2}$/.test(row[0] || "")
      );
      const hasTodayRow = rows.some(row => {
        const first = String(row[0] || "").replace(/[^A-Z0-9 ]/g, " ").trim();
        const match = first.match(/^(?:(?:[A-Z]{3})\s*)?0?(\d{1,2})(?:\s+(?:[A-Z]{3}))?$/);
        return match && Number(match[1]) === today.day;
      });
      return hasDateHeader && hasTodayRow;
    });
    if (year === today.year && month === today.month && hasExactTodayRow) return today;
  }
  throw new Error("Source date not recognized: no current dated heading or current-month chart row.");
}
function parseSattaSuperfastTodayTable(html, market, targetDay) {
  // This source uses a fixed MARKET | TIME | RECORD | YESTERDAY | TODAY table.
  // Read only the correct date column from the exact market row. In particular,
  // never let a previous-day number (e.g. Faridabad 81) leak into another market.
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

  const tables = [...String(html || "").matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)];
  const matches = [];
  for (const table of tables) {
    const rows = [...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(row =>
      [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => normalize(cell[1])));
    const headerIndex = rows.findIndex(row =>
      row.length >= 5 &&
      row.some(cell => cell === "MARKET") &&
      row.some(cell => cell === "TIME") &&
      row.some(cell => cell === "RECORD") &&
      row.some(cell => cell === "YESTERDAY") &&
      row.some(cell => cell === "TODAY"));
    if (headerIndex < 0) continue;
    const header = rows[headerIndex];
    const marketCol = header.indexOf("MARKET");
    const resultCol = header.indexOf(isTargetToday ? "TODAY" : "YESTERDAY");
    if (marketCol < 0 || resultCol < 0) continue;
    for (const row of rows.slice(headerIndex + 1)) {
      if (row.length <= Math.max(marketCol, resultCol)) continue;
      const rowMarket = row[marketCol];
      if (!aliases.some(alias => rowMarket === alias)) continue;
      const value = row[resultCol];
      if (/^\d{2}$/.test(value)) matches.push(value);
    }
  }
  const unique = [...new Set(matches)];
  return unique.length === 1 ? unique[0] : null;
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
      const monthName = new Intl.DateTimeFormat("en", { timeZone: "Asia/Kolkata", month: "long" })
        .format(new Date(Date.UTC(targetDay.year, targetDay.month - 1, targetDay.day))).toUpperCase();
      const monthShort = monthName.slice(0, 3);
      const day = String(targetDay.day);
      const dayWithSuffix = day + (targetDay.day % 10 === 1 && targetDay.day !== 11 ? "ST" :
        targetDay.day % 10 === 2 && targetDay.day !== 12 ? "ND" :
        targetDay.day % 10 === 3 && targetDay.day !== 13 ? "RD" : "TH");
      const dateCol = header.findIndex(cell => [
        monthName + " " + day, monthShort + " " + day,
        day + " " + monthName, day + " " + monthShort,
        dayWithSuffix + " " + monthName, dayWithSuffix + " " + monthShort,
        monthName + " " + dayWithSuffix, monthShort + " " + dayWithSuffix
      ].includes(cell));
      const resultCol = isTargetToday ? (todayCol >= 0 ? todayCol : dateCol) :
        (yesterdayCol >= 0 ? yesterdayCol : dateCol);
      if (resultCol < 0) continue;
      let gameCol = header.findIndex((cell, index) => index !== resultCol &&
        /^(GAME|GAMES|GAMES LIST|MARKET|RESULT|KHEL|गेम)$/.test(cell));
      if (gameCol < 0 && resultCol > 0 && !header[0]) gameCol = 0;
      if (gameCol < 0) continue;
      const matches = [];
      for (let r = h + 1; r < rows.length; r++) {
        const row = rows[r];
        if (row.length <= Math.max(gameCol, resultCol)) continue;
        const game = row[gameCol];
        if (!aliases.some(alias => game === alias || game.includes(alias) || game.split(" ").includes(alias))) continue;
        const value = row[resultCol];
        if (/^\d{2}$/.test(value)) matches.push(value);
      }
      const unique = [...new Set(matches)];
      if (unique.length === 1) return unique[0];
      if (unique.length > 1) return null;
    }
  }

  // Never infer a result from nearby page text. If the source does not expose
  // a date-labelled table row for this market, report no value for this source.
  return null;
}

function hasYearlyMonthGrid(html, targetDay) {
  const norm=value=>decodeHtml(String(value||"")).replace(/<[^>]+>/g," ")
    .replace(/[^A-Z0-9\u0900-\u097F ]/gi," ").replace(/\s+/g," ").trim().toUpperCase();
  const plain=norm(String(html||"").replace(/<script\b[\s\S]*?<\/script>/gi," "));
  if(!plain.includes(String(targetDay.year)))return false;
  const months={1:["JAN","JANUARY","जन","जनवरी"],2:["FEB","FEBRUARY","फर","फरवरी"],3:["MAR","MARCH","मार्च"],
    4:["APR","APRIL","अप्रै","अप्रैल"],5:["MAY","मई"],6:["JUN","JUNE","जून"],7:["JUL","JULY","जुला","जुलाई"],
    8:["AUG","AUGUST","अग","अगस्त"],9:["SEP","SEPTEMBER","सित","सितंबर"],10:["OCT","OCTOBER","अक्टू","अक्टूबर"],
    11:["NOV","NOVEMBER","नव","नवंबर"],12:["DEC","DECEMBER","दिस","दिसंबर"]};
  const tables=[...String(html||"").matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)];
  return tables.some(table=>{
    const rows=[...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(row=>
      [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell=>norm(cell[1])));
    const hi=rows.findIndex(row=>row.length>=10&&/^(DAY|DATE|दिन|तारीख)$/.test(row[0]||""));
    if(hi<0)return false;
    const col=rows[hi].findIndex((cell,i)=>i>0&&months[targetDay.month].some(m=>cell===m||cell.startsWith(m)));
    if(col<0)return false;
    return rows.slice(hi+1).some(row=>row[0]&&Number(row[0].replace(/\D/g,""))===targetDay.day);
  });
}

function parseYearlyMonthGrid(html, market, targetDay) {
  const norm = value => decodeHtml(String(value || "")).replace(/<[^>]+>/g, " ")
    .replace(/[^A-Z0-9\u0900-\u097F ]/gi, " ").replace(/\s+/g, " ").trim().toUpperCase();
  const plain = norm(String(html || "").replace(/<script\b[\s\S]*?<\/script>/gi, " "));
  if (!plain.includes(String(targetDay.year))) return null;
  const aliases = (market.source || []).map(norm);
  if (!aliases.some(alias => plain.slice(0, 1800).includes(alias))) return null;
  const months = {
    1:["JAN","JANUARY","जन","जनवरी"],2:["FEB","FEBRUARY","फर","फरवरी"],
    3:["MAR","MARCH","मार्च"],4:["APR","APRIL","अप्रै","अप्रैल"],
    5:["MAY","मई"],6:["JUN","JUNE","जून"],7:["JUL","JULY","जुला","जुलाई"],
    8:["AUG","AUGUST","अग","अगस्त"],9:["SEP","SEPTEMBER","सित","सितंबर"],
    10:["OCT","OCTOBER","अक्टू","अक्टूबर"],11:["NOV","NOVEMBER","नव","नवंबर"],
    12:["DEC","DECEMBER","दिस","दिसंबर"]
  };
  const tables = [...String(html || "").matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)];
  for (const table of tables) {
    const rows = [...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(row =>
      [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => norm(cell[1])));
    const hi = rows.findIndex(row => row.length >= 10 && /^(DAY|DATE|दिन|तारीख)$/.test(row[0] || ""));
    if (hi < 0) continue;
    const col = rows[hi].findIndex((cell,i) => i > 0 && months[targetDay.month].some(m => cell === m || cell.startsWith(m)));
    if (col < 0) continue;
    const row = rows.slice(hi+1).find(r => r[0] && Number(r[0].replace(/\D/g,"")) === targetDay.day);
    if (row && /^\d{2}$/.test(row[col] || "")) return row[col];
  }
  return null;
}

function parseMarketCardValue(html, market, targetDay) {
  const norm = value => decodeHtml(String(value || ""))
    .replace(/<[^>]+>/g, " ")
    .replace(/[^A-Z0-9\u0900-\u097F ]/gi, " ")
    .replace(/\s+/g, " ").trim().toUpperCase();
  const aliases = (market.source || []).map(norm);
  const lines = decodeHtml(String(html || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(?:td|th|tr|div|article|section|li|p|h[1-6])\s*>/gi, "\n")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .split(/[\r\n]+/).map(norm).filter(Boolean);
  const now = getIndiaDateParts();
  const useToday = targetDay.year === now.year && targetDay.month === now.month && targetDay.day === now.day;
  const label = useToday ? /^(?:TODAY|AAJ|आज)(?:\b|$)/i : /^(?:YESTERDAY|KAL|कल)(?:\b|$)/i;
  const allAliases = SOURCE_MARKETS.map(item => ({title:item.title, aliases:(item.source||[]).map(norm)}));
  const hasAlias = (line, list) => list.some(alias =>
    alias.length <= 2 ? line.split(" ").includes(alias) : line.includes(alias));
  const found = new Set();
  for (let i=0;i<lines.length;i++) {
    if (lines[i].length > 90 || !hasAlias(lines[i], aliases)) continue;
    const nearbyTime = [lines[i-1] || "", lines[i], lines[i+1] || ""].some(line =>
      /\b\d{1,2}:\d{2}\s*(?:AM|PM)\b/i.test(line));
    if (!nearbyTime) continue;
    for (let j=i+1;j<Math.min(lines.length,i+7);j++) {
      const line=lines[j];
      if (allAliases.some(item=>item.title!==market.title && hasAlias(line,item.aliases))) break;
      let match=line.match(/(?:TODAY|AAJ|आज|YESTERDAY|KAL|कल)\s*(?:RESULT)?\s*(?:\(\s*\d{1,2}[^)]*\))?\s*[:：|–—-]?\s*(\d{2})(?!\d)/i);
      if (label.test(line) && !match) {
        for(let k=j+1;k<Math.min(lines.length,j+3);k++) {
          if(/^\d{2}$/.test(lines[k])) {match=[lines[k],lines[k]];break;}
          if(/^(?:WAIT|PENDING|--|XX|अभी बाकी|रिजल्ट अभी नहीं आया)$/i.test(lines[k])) break;
        }
      }
      if(match && label.test(line)) found.add(match[1]);
    }
  }
  return found.size===1 ? [...found][0] : null;
}
function parseDateResultHistory(html, targetDay) {
  const norm=value=>decodeHtml(String(value||"")).replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
  const tables=[...String(html||"").matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)];
  for(const table of tables){const rows=[...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(row=>[...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c=>norm(c[1])));
    for(const row of rows){if(row.length<2)continue;const d=row[0].match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2}),?\s+(\d{4})/i);
      if(!d||Number(d[2])!==targetDay.day||Number(d[3])!==targetDay.year)continue;
      if(new Date(d[1]+" 1, "+targetDay.year).getMonth()+1!==targetDay.month)continue;
      if(/^\d{2}$/.test(row[1]))return row[1];}}
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
    "DESAWER": ["DSWR", "DISAWER", "DESAWAR", "DESAWER"],
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
    // DATE/DAY headers are not month names. Only enforce a month match
    // when the first header cell is actually a month label (e.g. NOV 24).
    const headerMonth = /^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b/.exec(header[0])?.[1] || null;
    if (headerMonth && headerMonth !== currentMonth) continue;
    const column = header.findIndex((cell, index) => index > 0 &&
      (aliasSet.some(alias => cell === alias) || codes.some(code => cell === code)));
    if (column < 0) continue;
    const dayRow = rows.find(row => {
      const firstCell = row[0].replace(/[^A-Z0-9 ]/g, " ").trim();
      const match = firstCell.match(/^(?:(?:[A-Z]{3})\s*)?0?(\d{1,2})(?:\s+(?:[A-Z]{3}))?$/);
      return match && Number(match[1]) === today.day;
    });
    // Only accept a two-digit result from the exact current-day row.
    // Some chart pages omit empty <td> cells from rows. That shifts later
    // columns left and can label Disawar's number as Faridabad/Gali.
    // Require a complete row matching the header width before reading.
    if (dayRow && dayRow.length !== header.length) continue;
    if (dayRow && dayRow[column] && /^\d{2}$/.test(dayRow[column])) return dayRow[column];
  }

  // Structured text-table fallback for sites that render chart rows with
  // div/span markup instead of semantic <table>/<tr>/<td> elements.
  // Preserve cell boundaries, then require an exact date header + exact
  // market header + exact target-day row before reading a two-digit value.
  const structured = decodeHtml(String(html || ""))
    .replace(/<\/(?:td|th)\s*>/gi, " | ")
    .replace(/<\/(?:tr|li|article|section)\s*>/gi, "\n")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ");
  const lines = structured.split(/[\r\n]+/)
    .map(line => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const dayTokens = new Set([
    String(targetDay.day),
    String(targetDay.day).padStart(2, "0"),
    String(targetDay.day).padStart(2, "0") + "-" + String(targetDay.month).padStart(2, "0"),
    String(targetDay.day).padStart(2, "0") + "/" + String(targetDay.month).padStart(2, "0")
  ]);
  for (let h = 0; h < lines.length; h++) {
    const headerCells = lines[h].split("|").map(normalize).filter(Boolean);
    const dateCol = headerCells.findIndex(cell => /^(DATE|DAY|TAREEKH|तारीख)$/.test(cell));
    if (dateCol < 0) continue;
    const marketCol = headerCells.findIndex((cell, index) => index !== dateCol &&
      aliases.some(alias => cell === alias || cell.includes(alias)));
    if (marketCol < 0) continue;
    for (let r = h + 1; r < Math.min(lines.length, h + 40); r++) {
      const rowCells = lines[r].split("|").map(normalize).filter(Boolean);
      if (rowCells.length <= Math.max(dateCol, marketCol)) continue;
      const rowDate = rowCells[dateCol].replace(/[^A-Z0-9/-]/g, "");
      if (!dayTokens.has(rowDate)) continue;
      const value = rowCells[marketCol];
      if (/^\d{2}$/.test(value)) return value;
      return null;
    }
  }

  // Never infer a result from nearby page text.
  return null;
}



function aiChartText(html) {
  return decodeHtml(String(html || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(?:td|th)\s*>/gi, " | ")
    .replace(/<\/(?:tr|li|article|section|div|p|h[1-6])\s*>/gi, "\n")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}
function aiCompact(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9\u0900-\u097F]/g, "");
}
async function parseUnresolvedMarketsWithDeepSeek(html, sourceUrl, markets, targetDays) {
  const host = new URL(sourceUrl).hostname.toLowerCase();
  if (!AI_ALLOWED_HOSTS.has(host)) return {values:{},reason:"ai_site_not_enabled"};
  const key=process.env.COARENA_API_KEY;
  const fullText=aiChartText(html);
  const fullCompact=aiCompact(fullText);
  const relevantMarkets=markets.filter(m=>(m.source||[]).some(alias=>{
    const a=aiCompact(alias); return a.length>=3 && fullCompact.includes(a);
  }));
  if(!relevantMarkets.length)return {values:{},reason:"no_requested_market_label_on_page"};
  // Send complete relevant HTML chart tables instead of a tiny excerpt.
  // Preserve every row and cell so date, market and result columns remain visible.
  const tableBlocks=[...String(html||"").matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map((match,index)=>{
    const rows=[...match[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(row=>
      [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
        .map(cell=>decodeHtml(cell[1].replace(/<[^>]+>/g," ")).replace(/\s+/g," ").trim())
        .join(" | ")
    ).filter(Boolean);
    return rows.length ? "HTML TABLE "+(index+1)+"\n"+rows.join("\n") : "";
  }).filter(Boolean);
  const relevantTables=tableBlocks.filter(block=>{
    const compact=aiCompact(block);
    return relevantMarkets.some(m=>(m.source||[]).some(alias=>{
      const a=aiCompact(alias); return a.length>=3 && compact.includes(a);
    }));
  });
  const fullPageText=fullText.slice(0,5000);
  const chartParts=[
    ...relevantTables,
    "FULL PAGE TEXT (beginning):\n"+fullPageText
  ];
  const chart=[...new Set(chartParts)].join("\n\n--- COMPLETE CHART SECTION ---\n\n").slice(0,24000);
  if(chart.length<80)return {values:{},reason:"chart_context_too_short"};
  const chartWasTruncated=relevantTables.join("\n").length>19000 || fullText.length>5000;
  const requested=relevantMarkets.map(m=>{
    const d=targetDays[m.title];
    return m.title+" aliases ["+(m.source||[]).slice(0,8).join(", ")+"] exact date "+
      d.year+"-"+String(d.month).padStart(2,"0")+"-"+String(d.day).padStart(2,"0");
  }).join("\n");
  try {
    const prompt=[
      "Strict chart transcription only. The supplied text comes from a website already configured in the normal results parser. Read the supplied chart rows; do not guess, infer, calculate, or use nearby dates.",
      "For each requested market, return a value only if its visible market label, exact requested date context, and two-digit result are shown in the same chart/table context.",
      "Include evidence as an exact contiguous quotation copied from the source text, showing market, date context, and result. Omit uncertain or absent results.",
      'Return JSON only: {"results":[{"market":"Disawar","value":"12","evidence":"exact copied quote"}]}',
      "Requested markets:\\n"+requested,"Source URL: "+sourceUrl,"Complete chart/page data (may include multiple full tables):\\n"+chart
    ].join("\n\n");
    const res=await fetch("https://coarena.ai/api/v1/chat/completions",{
      method:"POST",
      headers:{"Content-Type":"application/json","Authorization":"Bearer "+key},
      body:JSON.stringify({model:"deepseek-v4-1-flash-1017",messages:[{role:"user",content:prompt}],response_format:{type:"json_object"}}),
      signal:AbortSignal.timeout(25000)
    });
    if(!res.ok)return {values:{},reason:"coarena_http_"+res.status,detail:(await res.text()).slice(0,200)};
    const payload=await res.json();
    const raw=payload.choices?.[0]?.message?.content||"";
    let data;
    try{data=JSON.parse(raw);}catch(e){const m=raw.match(/\{[\s\S]*\}/);if(!m)return {values:{},reason:"coarena_invalid_json"};data=JSON.parse(m[0]);}
    const sourceCompact=aiCompact(chart), values={};
    for(const item of Array.isArray(data.results)?data.results:[]){
      const market=relevantMarkets.find(m=>m.title.toLowerCase()===String(item.market||"").trim().toLowerCase());
      const value=String(item.value||"").trim(), evidence=String(item.evidence||"").trim();
      if(!market||!/^\d{2}$/.test(value)||evidence.length<8)continue;
      const quote=aiCompact(evidence);
      if(quote.length<8||!sourceCompact.includes(quote))continue;
      const aliases=(market.source||[]).map(aiCompact).filter(a=>a.length>=3);
      if(!aliases.some(a=>quote.includes(a))||!quote.includes(value))continue;
      const d=targetDays[market.title], months=["JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE","JULY","AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER"];
      const day=String(d.day), month=months[d.month-1], short=month.slice(0,3);
      const dd=String(d.day).padStart(2,"0"), mm=String(d.month).padStart(2,"0"), yyyy=String(d.year);
      const dated=[day+" "+month,month+" "+day,day+" "+short,short+" "+day,
        month+" "+day+", "+yyyy,day+" "+month+" "+yyyy,
        yyyy+"-"+mm+"-"+dd,dd+"/"+mm+"/"+yyyy,day+"/"+mm+"/"+yyyy,
        dd+"-"+mm+"-"+yyyy,day+"-"+mm+"-"+yyyy].some(x=>quote.includes(aiCompact(x)));
      if(dated)values[market.title]=value;
    }
    return {values,reason:Object.keys(values).length?"deepseek_exact_evidence":"deepseek_no_verified_evidence",chartChars:chart.length,chartWasTruncated};
  }catch(e){return {values:{},reason:"coarena_request_error",detail:String(e.message||e).slice(0,180)};}
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
  const fetchOneSource = async sourceUrl => {
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
        const isCurrentYearGrid = hasYearlyMonthGrid(html, today);
        const isCurrentHistory = sourceUrl.includes("game-history.php") && Boolean(parseDateResultHistory(html, today));
        if (isCurrentYearGrid || isCurrentHistory) sourceDate = today;
        else {
          sourceDiagnostics.push({ pass: passLabel, url: sourceUrl, status: response.status, result: "date_not_recognized" });
          return null;
        }
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
      const aiExcludedMarkets = new Set();
      for (const market of RUN_MARKETS) {
        // These two "new-disawar" chart endpoints have produced premature
        // Faridabad and Ghaziabad values that are not today's results.
        // Keep them available for other markets, but never count them for these markets.
        const isNewDisawarChart =
          sourceUrl.includes("faridabadlucky.com/chart/new-disawar") ||
          sourceUrl.includes("delhilucky.com/chart/new-disawar");
        if (isNewDisawarChart &&
            (market.title === "Faridabad" || market.title === "Ghaziabad")) {
          aiExcludedMarkets.add(market.title);
          continue;
        }
        // sattaking.live currently labels an unconfirmed 44 as Ghaziabad.
        // Exclude only this market from this source; retain its other markets.
        if (new URL(sourceUrl).hostname.toLowerCase() === "sattaking.live" &&
            market.title === "Ghaziabad") {
          aiExcludedMarkets.add(market.title);
          continue;
        }
        const targetDay = market.title === "Gali" ? galiDate : today;
        // First choice: exact date row + exact market column in monthly charts.
        // 1XSatta uses a separate year-grid page per market; its home page
        // contains multiple compact cards and embedded tables, so never treat
        // a generic table there as a cross-market monthly chart.
        const is1xSatta = sourceUrl.includes("1xsatta.today/");
        const isSattaSuperfast = new URL(sourceUrl).hostname.toLowerCase() === "satta-superfast.com";
        if (isSattaSuperfast) {
          aiExcludedMarkets.add(market.title);
          const value = parseSattaSuperfastTodayTable(html, market, targetDay);
          if (value) {
            marketResults[market.title] = value;
            marketParsers[market.title] = "satta_superfast_exact_market_today_yesterday_table";
          }
          // Do not fall through to generic/card/AI parsing for this source:
          // a missing or '--' cell must remain missing, never guessed.
          continue;
        }
        let value = is1xSatta ? null : parseMarketValues(html, market.source, targetDay);
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
          continue;
        }
        value = parseMarketCardValue(html, market, targetDay);
        if (value) {
          marketResults[market.title] = value;
          marketParsers[market.title] = "market_card_today_label";
          continue;
        }
        value = parseYearlyMonthGrid(html, market, targetDay);
        if (value) {
          marketResults[market.title] = value;
          marketParsers[market.title] = "dedicated_yearly_month_grid";
          continue;
        }
        if (market.title === "Shree Ganesh" && sourceUrl.includes("game-history.php")) {
          value = parseDateResultHistory(html, targetDay);
          if (value) {
            marketResults[market.title] = value;
            marketParsers[market.title] = "date_result_history_table";
          }
        }
      }

      // DeepSeek runs on every five-minute sync cycle, alongside the normal
      // parser, for every configured source where one or more market values
      // remain unresolved. It receives all unresolved market labels in one
      // focused request per source; parser-confirmed values remain untouched.
      const unresolvedMarkets = RUN_MARKETS.filter(market =>
        !marketResults[market.title] && !aiExcludedMarkets.has(market.title)
      );
      const aiSourceUrl = new URL(sourceUrl);
      const aiEnabledForSource = AI_ALLOWED_HOSTS.has(aiSourceUrl.hostname.toLowerCase()) && (aiSourceUrl.pathname === "/" || aiSourceUrl.pathname === "");
      if (unresolvedMarkets.length && aiEnabledForSource && process.env.COARENA_API_KEY) {
        const targetDays = Object.fromEntries(unresolvedMarkets.map(market => [
          market.title, market.title === "Gali" ? galiDate : today
        ]));
        const aiResult = await runDeepSeekSequentially(() =>
          parseUnresolvedMarketsWithDeepSeek(html, sourceUrl, unresolvedMarkets, targetDays)
        );
        for (const [marketTitle, value] of Object.entries(aiResult.values || {})) {
          if (!marketResults[marketTitle]) {
            marketResults[marketTitle] = value;
            marketParsers[marketTitle] = "deepseek_exact_source_evidence";
          }
        }
        sourceDiagnostics.push({
          pass: passLabel, url: sourceUrl, result: "deepseek_fallback",
          aiProvider: "coarena", aiModel: "deepseek-v4-1-flash-1017",
          aiRequestedMarkets: unresolvedMarkets.map(market => market.title),
          aiReason: aiResult.reason, aiMarketsFound: Object.keys(aiResult.values || {}),
          chartChars: aiResult.chartChars, chartWasTruncated: aiResult.chartWasTruncated,
          detail: aiResult.detail || undefined
        });
      }

      // Equal two-digit values may legitimately occur in different markets.
      // Keep independently labelled results instead of deleting both.
      const ambiguousValues = [];
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
  };

  // Fetch the four user-prioritized domains first. All other sources are
  // still checked in the same cycle; priority never overrides the
  // three-independent-domain consensus or gives a source extra votes.
  const priorityHosts = new Set([
    "kingsofsatta.com",
    "satta-king-gali.com",
    "sattafree.com",
    "galidisawer.com"
  ]);
  const priorityUrls = SOURCE_URLS.filter(url => priorityHosts.has(new URL(url).hostname.toLowerCase()));
  const otherUrls = SOURCE_URLS.filter(url => !priorityHosts.has(new URL(url).hostname.toLowerCase()));
  const priorityObservations = await Promise.all(priorityUrls.map(fetchOneSource));
  const otherObservations = await Promise.all(otherUrls.map(fetchOneSource));
  return [...priorityObservations, ...otherObservations].filter(Boolean);
}

function buildConsensus(observations) {
  const consensus = {};
  const pending = {};
  for (const market of RUN_MARKETS) {
    // One independent domain gets exactly one vote per market. If two pages
    // on the same domain disagree, that domain is excluded for this market.
    const domainVotes = new Map();
    for (const source of observations) {
      const value = String(source.marketResults[market.title] || "").trim();
      const host = String(source.host || "").toLowerCase();
      if (!/^\d{2}$/.test(value) || !host) continue;
      if (!domainVotes.has(host)) domainVotes.set(host, new Map());
      const values = domainVotes.get(host);
      if (!values.has(value)) values.set(value, source.url);
    }

    const votes = new Map();
    const disputedDomains = [];
    for (const [host, values] of domainVotes.entries()) {
      if (values.size !== 1) {
        disputedDomains.push(host);
        continue;
      }
      const [value, url] = [...values.entries()][0];
      if (!votes.has(value)) votes.set(value, new Map());
      votes.get(value).set(host, url);
    }

    const ranked = [...votes.entries()].sort((a, b) => b[1].size - a[1].size);
    const winner = ranked[0];
    const tiedForFirst = Boolean(winner && ranked[1] && winner[1].size === ranked[1][1].size);
    if (winner && winner[1].size >= 3 && !tiedForFirst) {
      consensus[market.title] = {
        value: winner[0],
        sources: [...winner[1].values()],
        domains: [...winner[1].keys()],
        voteCounts: ranked.map(([value, hosts]) => ({ value, count: hosts.size })),
        disputedDomains
      };
    } else {
      pending[market.title] = {
        votes: ranked.map(([value, hosts]) => ({ value, count: hosts.size, sources: [...hosts.values()] })),
        disputedDomains,
        reason: !winner || winner[1].size < 3 ? "fewer_than_three_independent_domains" :
          (tiedForFirst ? "tie_for_highest_votes" : "no_clear_majority")
      };
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
    console.log("No three-domain consensus in first pass; market will be checked again.");
    return;
  }

  cycleHadFirstConsensus = true;
  // Publish as soon as the normal parser finds the same two-digit value on
  // two independent domains. A second fetch is reserved only for a repeat
  // of yesterday's number, where the stricter anti-repeat safeguard remains.
  const second = { consensus: {} };
  const verified = {};
  const pendingMarkets = [];
  for (const market of RUN_MARKETS) {
    const a = first.consensus[market.title];
    if (a) {
      verified[market.title] = {
        value: a.value, sources: a.sources, domains: a.domains,
        checkedAt: new Date().toISOString(),
        firstPassDomains: a.domains, recheckDomains: [],
        rule: "same_value_on_three_independent_domains_single_check"
      };
    } else if (first.pending[market.title]) {
      pendingMarkets.push(market.title);
    }
  }

  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  }
  const indiaToday = getIndiaDateParts();
  const galiResultDay = getGaliResultDateParts();
  const todayDate = new Date(Date.UTC(indiaToday.year, indiaToday.month - 1, indiaToday.day, 12));

  // Do not accept results before the market's scheduled release time (India local).
  const indiaClock = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).format(new Date());
  const [clockHour, clockMinute] = indiaClock.split(":").map(Number);
  const nowMinutes = clockHour * 60 + clockMinute;
  const notYetReleased = RUN_MARKETS.filter(market => {
    const scheduled = MARKET_SCHEDULES[market.title];
    if (!scheduled) return false;
    const [scheduledHour, scheduledMinute] = scheduled.split(":").map(Number);
    return nowMinutes < scheduledHour * 60 + scheduledMinute;
  });
  for (const market of notYetReleased) {
    delete verified[market.title];
    if (!pendingMarkets.includes(market.title)) pendingMarkets.push(market.title);
    console.log("Market scheduled release time not reached; withholding:", market.title);
  }

  // Roll back the premature auto-published Faridabad 45 seen in the latest
  // cycle. Manual records are untouched; a later valid consensus may publish.
  const faridabadStart = new Date(Date.UTC(indiaToday.year, indiaToday.month - 1, indiaToday.day));
  const faridabadEnd = new Date(Date.UTC(indiaToday.year, indiaToday.month - 1, indiaToday.day + 1));
  const rollback = await Result.updateMany({
    title: "Faridabad", resultText: "45", resultSource: "automatic",
    resultDate: { $gte: faridabadStart, $lt: faridabadEnd }
  }, { $set: { published: false, deleted: true } });
  if (rollback.modifiedCount) {
    console.log("Withdrew premature auto-published Faridabad 45; waiting for valid current-day evidence.");
    await updatePublicSnapshot();
  }

  const repeatCandidates = [];
  for (const market of RUN_MARKETS) {
    const candidate = verified[market.title];
    if (!candidate) continue;
    const marketDate = market.title === "Gali"
      ? new Date(Date.UTC(galiResultDay.year, galiResultDay.month - 1, galiResultDay.day, 12))
      : todayDate;
    const previousDate = new Date(marketDate.getTime() - 86400000);
    const previousDayFilter = {
      title: market.title,
      resultDate: {
        $gte: new Date(Date.UTC(previousDate.getUTCFullYear(), previousDate.getUTCMonth(), previousDate.getUTCDate())),
        $lt: new Date(Date.UTC(previousDate.getUTCFullYear(), previousDate.getUTCMonth(), previousDate.getUTCDate() + 1))
      }
    };
    const previousRecord = await Result.findOne(previousDayFilter).select("resultText").lean();
    if (previousRecord && String(previousRecord.resultText || "").trim() === candidate.value) {
      repeatCandidates.push(market.title);
    }
  }

  if (repeatCandidates.length) {
    console.log("Same-as-yesterday result detected; running extra recheck only for:", repeatCandidates.join(", "));
    const secondPass = await fetchSourceHtml("repeat_number_recheck");
    const secondPassConsensus = buildConsensus(secondPass);
    for (const marketTitle of repeatCandidates) {
      const a = first.consensus[marketTitle];
      const b = secondPassConsensus.consensus[marketTitle];
      if (a && b && a.value === b.value && b.domains.length >= 3) {
        const combined = [...new Set([...a.sources, ...b.sources])];
        const domains = [...new Set(combined.map(url => new URL(url).hostname.toLowerCase()))];
        verified[marketTitle] = {
          value: a.value, sources: combined, domains,
          checkedAt: new Date().toISOString(),
          firstPassDomains: a.domains, recheckDomains: b.domains,
          rule: "same_value_on_two_distinct_domains_in_two_checks_for_repeat"
        };
        second.consensus[marketTitle] = b;
      } else {
        delete verified[marketTitle];
        pendingMarkets.push(marketTitle);
        console.log("Repeated number not confirmed in extra recheck; left unchanged:", marketTitle);
      }
    }
  }

  if (!Object.keys(verified).length) {
    console.log("No publishable three-domain consensus in this cycle.");
    return;
  }

  const date = todayDate;
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

    // Repeated numbers are handled by the extra independent recheck above.
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
      console.log("Repeated number failed the extra three-domain recheck; left unchanged:", market.title, evidence.value);
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
        // A verified match must be publicly visible even when the matching row
        // was entered manually earlier. Preserve its value and manual ownership,
        // but publish it and attach the independent source evidence.
        await Result.updateOne(
          { _id: existing._id },
          { $set: {
            published: true,
            deleted: false,
            sourceUrl: evidence.sources.join(", "),
            verificationMeta: evidence
          } }
        );
        sourceDiagnostics.push({
          result: isManual ? "manual_match_published" : "already_matches",
          market: market.title, existingValue, incomingValue: evidence.value,
          publicStatus: "published",
          candidateSources: evidence.sources
        });
        insertedOrUpdated++;
        cycleResolvedMarkets.add(market.title);
        console.log(isManual ? "Manual result matched verified sources and is now published:" : "Already matches verified source:", market.title, evidence.value);
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
      // Replace stale automatic rows when a fresh three-domain consensus exists.
      // Manual rows remain protected by the branch above.
      await Result.updateOne(
        { _id: existing._id },
        { $set: {
          title: market.title, resultText: evidence.value, resultDate: marketDate,
          published: true, deleted: false, sourceUrl: evidence.sources.join(", "),
          resultSource: "automatic", verificationMeta: evidence,
          ownerUserId: null, cityId: null
        } }
      );
      insertedOrUpdated++;
      cycleResolvedMarkets.add(market.title);
      sourceDiagnostics.push({
        result: "automatic_record_replaced_by_verified_consensus",
        market: market.title, existingValue, incomingValue: evidence.value,
        publicStatus: "published", candidateSources: evidence.sources
      });
      console.log("Replaced outdated automatic record with verified consensus:", market.title, existingValue, "->", evidence.value);
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
  const summary = insertedOrUpdated + " मार्केट रिकॉर्ड दो स्वतंत्र डोमेन के सामान्य Parser मिलान के तुरंत बाद sync हुए।";
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
    await publishSyncStatus("success", "इस चक्र की सामान्य Automatic Result Sync जाँच पूरी हुई। तीन स्वतंत्र वेबसाइटों पर समान Parser रिजल्ट मिलने पर तुरंत publish किया गया; लगातार समान नंबर पर अतिरिक्त recheck लागू है।");
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