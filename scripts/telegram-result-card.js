const sharp = require("sharp");

function xml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;"
  })[ch]);
}

function indiaDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "आज";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata", day: "2-digit", month: "long", year: "numeric"
  }).format(date);
}

async function createResultCardPng(title, resultText, resultDate) {
  const market = xml(title || "Result");
  const result = xml(resultText || "--");
  const date = xml(indiaDate(resultDate));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#101526"/><stop offset="1" stop-color="#25213b"/>
      </linearGradient>
      <linearGradient id="gold" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#f5d77b"/><stop offset=".5" stop-color="#fff0b3"/><stop offset="1" stop-color="#d69b32"/>
      </linearGradient>
    </defs>
    <rect width="1080" height="1350" fill="url(#bg)"/>
    <rect x="38" y="38" width="1004" height="1274" rx="42" fill="none" stroke="url(#gold)" stroke-width="5"/>
    <circle cx="540" cy="260" r="120" fill="#ffffff" opacity=".035"/>
    <text x="540" y="180" text-anchor="middle" font-family="Arial,sans-serif" font-size="72" font-weight="bold" fill="url(#gold)">👑 SATTA KING 👑</text>
    <text x="540" y="250" text-anchor="middle" font-family="Arial,sans-serif" font-size="34" letter-spacing="9" fill="#ffffff">RESULTS PORTAL</text>
    <path d="M190 330 H890" stroke="url(#gold)" stroke-width="3" opacity=".8"/>
    <text x="540" y="485" text-anchor="middle" font-family="Arial,sans-serif" font-size="58" font-weight="bold" fill="#ffffff">${market}</text>
    <text x="540" y="610" text-anchor="middle" font-family="Arial,sans-serif" font-size="34" fill="#e7d7a4">TODAY'S RESULT</text>
    <rect x="145" y="680" width="790" height="270" rx="36" fill="#ffffff" opacity=".08" stroke="#e8c66e" stroke-width="3"/>
    <text x="540" y="865" text-anchor="middle" font-family="Arial,sans-serif" font-size="150" font-weight="bold" fill="url(#gold)">${result}</text>
    <path d="M190 1030 H890" stroke="url(#gold)" stroke-width="3" opacity=".8"/>
    <text x="540" y="1120" text-anchor="middle" font-family="Arial,sans-serif" font-size="38" fill="#ffffff">DATE: ${date}</text>
    <text x="540" y="1220" text-anchor="middle" font-family="Arial,sans-serif" font-size="28" fill="#d8d3c5">Official Result Update</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

module.exports = { createResultCardPng };
