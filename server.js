require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const XLSX = require("xlsx");
const { createResultCardPng } = require("./scripts/telegram-result-card");

const app = express();
// Render runs behind one trusted proxy; use the original client IP for login throttling.
app.set("trust proxy", 1);
// Start CSP in report-only mode first: collect browser violation reports in DevTools
// without blocking existing inline scripts, styles, or cross-origin API requests.
app.use(helmet({
  contentSecurityPolicy: {
    reportOnly: true
  }
}));
app.use(express.json({ limit: "25mb" }));
app.use(cookieParser());

// CSRF defense for cookie-authenticated write requests.
// SameSite=Strict is retained as defense-in-depth; Origin/Referer must also
// match this exact service origin for every authenticated state-changing request.
app.use((req, res, next) => {
  const isWrite = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method);
  const hasSessionCookie = !!(req.cookies.admin_session || req.cookies.user_session);
  if (!isWrite || !hasSessionCookie) return next();

  const expectedOrigin = `${req.secure || req.get("x-forwarded-proto") === "https" ? "https" : req.protocol}://${req.get("host")}`;
  const supplied = req.get("Origin") || req.get("Referer");
  if (!supplied) return res.status(403).json({ error: "Request blocked: missing CSRF origin." });

  try {
    const actualOrigin = new URL(supplied).origin;
    if (actualOrigin !== expectedOrigin) {
      return res.status(403).json({ error: "Request blocked: cross-origin request." });
    }
  } catch {
    return res.status(403).json({ error: "Request blocked: invalid request origin." });
  }
  next();
});

// Allow the GitHub Pages public frontend (and the earlier Firebase preview) to read only public GET APIs.
const publicFrontendOrigins = new Set([
  "https://jasmelsolanki2017-svg.github.io",
  "https://rk-bhai-results-portal.web.app",
  "https://rk-bhai-results-portal.firebaseapp.com"
]);
const publicFrontendApiPaths = new Set([
  "/api/demo/register",
  "/api/demo/login",
  "/api/demo/me",
  "/api/demo/plays",
  "/api/demo/settle",
  "/api/demo/transactions",
  "/api/demo/notifications",
  "/api/demo/leaderboard",
  "/api/demo/results",
  "/api/demo/config",
  "/api/results",
  "/api/public/cities",
  "/api/public/export.csv",
  "/api/public/poster",
  "/api/public/announcement",
  "/api/public/popup-ad",
  "/api/public/popup-ads",
  "/api/public/blink-messages",
  "/api/visitor/track",
  "/api/visitor/heartbeat",
  "/api/public/online"
]);
app.use((req, res, next) => {
  if (!publicFrontendApiPaths.has(req.path)) return next();
  const origin = req.get("Origin");
  if (origin && publicFrontendOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }
  if (req.method === "OPTIONS") {
    if (origin && publicFrontendOrigins.has(origin)) return res.sendStatus(204);
    return res.sendStatus(403);
  }
  next();
});
async function hasAdminSession(req) {
  try {
    const token = req.cookies.admin_session;
    if (!token) return false;
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.role !== "admin" || !Number.isInteger(payload.sessionVersion)) return false;
    const state = await AdminAuthState.findOne({ key: "admin" }).select("sessionVersion").lean();
    return !!state && payload.sessionVersion === state.sessionVersion;
  } catch {
    return false;
  }
}

// Admin HTML routes are gated before static files are served. Without a valid
// admin cookie, only the standalone username/password page is returned.
app.use((req, res, next) => {
  const adminPages = new Set(["/admin", "/admin/audit", "/admin/", "/admin/advertisements", "/admin/users", "/admin.html", "/admin-users.html", "/admin/export.html", "/admin/backup.html", "/visitors.html"]);
  if (!adminPages.has(req.path)) return next();
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  hasAdminSession(req).then(valid => {
    if (!valid) return res.sendFile(path.join(__dirname, "public", "admin-login.html"));
    if (req.path === "/admin.html") return res.sendFile(path.join(__dirname, "public", "admin.html"));
    if (req.path === "/admin/users" || req.path === "/admin-users.html") return res.sendFile(path.join(__dirname, "public", "admin-users.html"));
    next();
  }).catch(() => res.sendFile(path.join(__dirname, "public", "admin-login.html")));
  return;
});

app.use(express.static(path.join(__dirname, "public")));
app.get("/admin/audit", (req, res) => res.sendFile(path.join(__dirname, "reports", "site-audit-2026-11-25.html")));
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.get("/admin/advertisements", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.get("/user", (req, res) => res.sendFile(path.join(__dirname, "public", "user.html")));
app.get("/admin/users", (req, res) => res.sendFile(path.join(__dirname, "public", "admin-users.html")));

const User = mongoose.model("PortalUser", new mongoose.Schema({
  name: { type: String, default: "", trim: true, maxlength: 80 },
  username: { type: String, required: true, unique: true, trim: true, lowercase: true, maxlength: 40 },
  mobile: { type: String, default: "", trim: true },
  email: { type: String, default: "", trim: true, lowercase: true },
  passwordHash: { type: String, required: true },
  mustChangePassword: { type: Boolean, default: true },
  active: { type: Boolean, default: true },
  expiresAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
}));

const DemoPlayer = mongoose.model("DemoPlayer", new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
  mobile: { type: String, required: true, unique: true, match: /^[6-9]\d{9}$/ },
  email: { type: String, default: "", trim: true, lowercase: true, maxlength: 120 },
  passwordHash: { type: String, required: true },
  status: { type: String, enum: ["pending", "approved", "rejected", "disabled"], default: "pending", index: true },
  walletPoints: { type: Number, default: 500, min: 0 },
  createdAt: { type: Date, default: Date.now },
  approvedAt: { type: Date, default: null }
}, { versionKey: false }));

const DemoPlay = mongoose.model("DemoPlay", new mongoose.Schema({
  playerId: { type: mongoose.Schema.Types.ObjectId, ref: "DemoPlayer", required: true, index: true },
  market: { type: String, required: true, trim: true, maxlength: 80 },
  number: { type: String, required: true, match: /^\d{2}$/ },
  playType: { type: String, enum: ["NUMBER", "LINE"], default: "NUMBER" },
  lineDigit: { type: Number, min: 0, max: 9, default: null },
  points: { type: Number, required: true, min: 1, max: 1000000 },
  status: { type: String, enum: ["PENDING", "WIN", "NO MATCH"], default: "PENDING", index: true },
  playDate: { type: String, required: true, index: true },
  result: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now },
  resolvedAt: { type: Date, default: null }
}, { versionKey: false }));
DemoPlay.schema.index({ playerId: 1, createdAt: -1 });
const DemoWalletTransaction = mongoose.model("DemoWalletTransaction", new mongoose.Schema({
 playerId:{type:mongoose.Schema.Types.ObjectId,ref:"DemoPlayer",required:true,index:true},
 type:{type:String,enum:["CREDIT","DEBIT"],required:true},amount:{type:Number,required:true,min:1},
 reason:{type:String,required:true,maxlength:160},createdAt:{type:Date,default:Date.now}
},{versionKey:false}));
DemoWalletTransaction.schema.index({playerId:1,createdAt:-1});
const DemoGameSetting = mongoose.model("DemoGameSetting",new mongoose.Schema({
 key:{type:String,default:"global",unique:true},enabled:{type:Boolean,default:true},
 minPoints:{type:Number,default:1,min:1,max:1000000},maxPoints:{type:Number,default:1000000,min:1,max:1000000},
 updatedAt:{type:Date,default:Date.now}
},{versionKey:false}));

const AdminAuthState = mongoose.model("AdminAuthState", new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  sessionVersion: { type: Number, default: 1 }
}, { versionKey: false }));

const HistoricalImport = mongoose.model("HistoricalImport", new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  importedAt: { type: Date, default: Date.now },
  recordCount: { type: Number, default: 0 },
  declaredCount: { type: Number, default: 0 }
}));

const City = mongoose.model("PortalCity", new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "PortalUser", required: true },
  cityName: { type: String, required: true, trim: true, maxlength: 60 },
  expectedTime: { type: String, default: "" },
  status: { type: String, enum: ["pending", "approved", "rejected", "returned", "hidden"], default: "pending" },
  createdAt: { type: Date, default: Date.now },
  reviewedAt: { type: Date, default: null }
}));

const Poster = mongoose.model("PortalPoster", new mongoose.Schema({heading:{type:String,default:"",maxlength:120},description:{type:String,default:"",maxlength:1000},buttonText:{type:String,default:""},buttonUrl:{type:String,default:""},design:{type:mongoose.Schema.Types.Mixed,default:{}},enabled:{type:Boolean,default:false},updatedAt:{type:Date,default:Date.now}}));
const PopupAd = mongoose.model("PortalPopupAd", new mongoose.Schema({title:{type:String,default:"",maxlength:120},description:{type:String,default:"",maxlength:500},imageData:{type:String,default:""},buttonText:{type:String,default:"अभी देखें",maxlength:40},buttonUrl:{type:String,default:"",maxlength:500},delaySeconds:{type:Number,default:5},frequencyMinutes:{type:Number,default:0},enabled:{type:Boolean,default:false},updatedAt:{type:Date,default:Date.now}}));
const PopupAdItem = mongoose.model("PortalPopupAdItem", new mongoose.Schema({title:{type:String,default:"",maxlength:120},description:{type:String,default:"",maxlength:500},imageData:{type:String,default:""},buttonText:{type:String,default:"अभी देखें",maxlength:40},buttonUrl:{type:String,default:"",maxlength:500},delaySeconds:{type:Number,default:0},frequencyMinutes:{type:Number,default:0},design:{type:mongoose.Schema.Types.Mixed,default:{}},enabled:{type:Boolean,default:false},createdAt:{type:Date,default:Date.now},updatedAt:{type:Date,default:Date.now}}));
const BlinkMessage = mongoose.model("PortalBlinkMessage", new mongoose.Schema({title:{type:String,default:"",maxlength:100},message:{type:String,default:"",maxlength:500},link:{type:String,default:"",maxlength:500},backgroundColor:{type:String,default:"#20170d"},textColor:{type:String,default:"#fff0c2"},borderColor:{type:String,default:"#d6ad55"},speed:{type:Number,default:1},enabled:{type:Boolean,default:false},createdAt:{type:Date,default:Date.now},updatedAt:{type:Date,default:Date.now}}));
const Announcement = mongoose.model("PortalAnnouncement", new mongoose.Schema({title:{type:String,default:"",maxlength:120},message:{type:String,default:"",maxlength:1000},enabled:{type:Boolean,default:false},updatedAt:{type:Date,default:Date.now}}));
const ResultSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 100 },
  resultText: { type: String, required: true, trim: true, maxlength: 300 },
  resultDate: { type: Date, required: true },
  published: { type: Boolean, default: false },
  deleted: { type: Boolean, default: false },
  sourceUrl: { type: String, default: "" },
  resultSource: { type: String, enum: ["manual", "automatic"], default: "manual", index: true },
  syncReview: { type: mongoose.Schema.Types.Mixed, default: null },
  ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: "PortalUser", default: null, index: true },
  cityId: { type: mongoose.Schema.Types.ObjectId, ref: "PortalCity", default: null, index: true },
  createdAt: { type: Date, default: Date.now }
});

// Keep the monthly admin chart query and sort responsive on larger result collections.
ResultSchema.index({ resultDate: -1, title: 1 });
const Result = mongoose.model("Result", ResultSchema);

// Notify Telegram only for explicitly published, non-deleted results.
async function sendTelegramResultNow(row) {
  const endpoint = process.env.TELEGRAM_WORKER_URL;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!endpoint || !secret) throw new Error("Telegram Worker की environment settings उपलब्ध नहीं हैं।");
  if (!row || row.published !== true || row.deleted === true) throw new Error("केवल प्रकाशित और सक्रिय रिजल्ट भेज सकते हैं।");
  const card = await createResultCardPng(row.title, row.resultText, row.resultDate);
  const response = await fetch(endpoint.replace(/\/$/, "") + "/publish", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-webhook-secret": secret },
    body: JSON.stringify({
      id: String(row._id), title: row.title, resultText: row.resultText,
      resultDate: row.resultDate, published: true, deleted: false,
      cardImageBase64: card.toString("base64")
    }),
    signal: AbortSignal.timeout(15000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(result.error || "Telegram Worker HTTP " + response.status);
  return result;
}

async function notifyTelegramPublishedResult(row) {
  if (!row || row.published !== true || row.deleted === true) return;
  try {
    await sendTelegramResultNow(row);
    console.log("Telegram photo publish notification accepted:", String(row._id));
  } catch (error) {
    console.error("Telegram photo publish notification failed:", error.message);
  }
}

// Store one record for every public page load from either frontend.
const VisitorVisit = mongoose.model("VisitorVisit", new mongoose.Schema({
  site: { type: String, enum: ["github_pages", "render"], required: true },
  visitorId: { type: String, default: "", index: true },
  createdAt: { type: Date, default: Date.now, index: true }
}, { versionKey: false }));

// One active presence record per browser tab; no IP or personal details are stored.
const OnlineVisitor = mongoose.model("OnlineVisitor", new mongoose.Schema({
  sessionId: { type: String, required: true, unique: true },
  site: { type: String, enum: ["github_pages", "render"], required: true },
  lastSeen: { type: Date, default: Date.now, index: true }
}, { versionKey: false }));


// Prefer a pre-generated bcrypt hash. ADMIN_PASSWORD is supported for simple
// Render setup and is converted to a bcrypt hash once when the process starts.
const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH ||
  (process.env.ADMIN_PASSWORD ? bcrypt.hashSync(process.env.ADMIN_PASSWORD, 12) : "");

async function userOnly(req, res, next) {
  try {
    const token = req.cookies.user_session;
    if (!token) return res.status(401).json({ error: "Login required" });
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.role !== "user") return res.status(403).json({ error: "Forbidden" });
    const user = await User.findById(payload.sub).select("active mustChangePassword expiresAt").lean();
    if (!user || !user.active || (user.expiresAt && user.expiresAt <= new Date())) return res.status(403).json({ error: "आपका account बंद है या अवधि समाप्त हो गई है। Admin approval जरूरी है।" });
    if (user.mustChangePassword) return res.status(403).json({ error: "पहले अपना default password बदलें।" });
    req.portalUserId = payload.sub;
    next();
  } catch { return res.status(401).json({ error: "Session expired. Login again." }); }
}

async function adminOnly(req, res, next) {
  try {
    const token = req.cookies.admin_session;
    if (!token) return res.status(401).json({ error: "Login required" });
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.role !== "admin" || !Number.isInteger(payload.sessionVersion)) return res.status(401).json({ error: "Session expired. Login again." });
    const state = await AdminAuthState.findOne({ key: "admin" }).select("sessionVersion").lean();
    if (!state || payload.sessionVersion !== state.sessionVersion) return res.status(401).json({ error: "Session expired. Login again." });
    next();
  } catch {
    return res.status(401).json({ error: "Session expired. Login again." });
  }
}

async function demoPlayerOnly(req, res, next) {
  try {
    const header = String(req.get("Authorization") || "");
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return res.status(401).json({ error: "Demo account में login करें।" });
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.role !== "demo_player" || !payload.sub) return res.status(403).json({ error: "Demo access denied." });
    const player = await DemoPlayer.findById(payload.sub).select("name mobile status").lean();
    if (!player || player.status !== "approved") return res.status(403).json({ error: "आपका Demo account approved नहीं है या बंद कर दिया गया है।" });
    req.demoPlayer = { id: String(player._id), name: player.name, mobile: player.mobile };
    next();
  } catch {
    return res.status(401).json({ error: "Demo session समाप्त हो गया। दोबारा login करें।" });
  }
}

const demoAuthAttempts = new Map();
function demoRateLimit(req, res, next) {
  const key = (req.ip || "unknown") + ":" + req.path;
  const now = Date.now();
  const old = demoAuthAttempts.get(key);
  const record = !old || now - old.startedAt > 15 * 60 * 1000 ? { startedAt: now, count: 0 } : old;
  if (record.count >= 12) return res.status(429).json({ error: "बहुत बार प्रयास हुए। 15 मिनट बाद फिर कोशिश करें।" });
  record.count++;
  demoAuthAttempts.set(key, record);
  next();
}



// Keep API requests from querying MongoDB while Atlas is disconnected.
// This prevents async route failures from restarting the web process during outages.
app.use("/api", (req, res, next) => {
  if (req.path === "/health") return next();
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "Database is temporarily unavailable. Please try again shortly." });
  }
  next();
});

app.post("/api/demo/register", demoRateLimit, async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const mobile = String(req.body?.mobile || "").replace(/\D/g, "");
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (name.length < 2 || name.length > 80) return res.status(400).json({ error: "नाम 2 से 80 अक्षर में लिखें।" });
  if (!/^[6-9]\d{9}$/.test(mobile)) return res.status(400).json({ error: "सही 10 अंकों का मोबाइल नंबर लिखें।" });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Email सही लिखें या खाली छोड़ें।" });
  if (password.length < 8 || password.length > 100) return res.status(400).json({ error: "Password कम से कम 8 अक्षर का रखें।" });
  if (await DemoPlayer.exists({ mobile })) return res.status(409).json({ error: "इस मोबाइल नंबर से Demo account पहले से बना है।" });
  try {
    const created = await DemoPlayer.create({ name, mobile, email, passwordHash: await bcrypt.hash(password, 12), status: "pending" });
    await DemoWalletTransaction.create({ playerId: created._id, type: "CREDIT", amount: 500, reason: "नया Demo Wallet शुरू किया" });
    res.status(201).json({ ok: true, status: "pending", message: "Registration सफल। Admin approval के बाद आप login कर सकेंगे।" });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: "इस मोबाइल नंबर से Demo account पहले से बना है।" });
    throw error;
  }
});

app.post("/api/demo/login", demoRateLimit, async (req, res) => {
  const mobile = String(req.body?.mobile || "").replace(/\D/g, "");
  const password = String(req.body?.password || "");
  const player = await DemoPlayer.findOne({ mobile });
  if (!player || !(await bcrypt.compare(password, player.passwordHash))) return res.status(401).json({ error: "मोबाइल नंबर या Password गलत है।" });
  if (player.status === "pending") return res.status(403).json({ status: "pending", error: "आपका account Admin approval का इंतजार कर रहा है।" });
  if (player.status === "rejected") return res.status(403).json({ status: "rejected", error: "आपका registration approve नहीं हुआ। Admin से संपर्क करें।" });
  if (player.status !== "approved") return res.status(403).json({ status: "disabled", error: "आपका Demo account बंद है। Admin से संपर्क करें।" });
  const token = jwt.sign({ role: "demo_player", sub: String(player._id) }, process.env.JWT_SECRET, { expiresIn: "12h" });
  res.json({ ok: true, token, player: { id: String(player._id), name: player.name, mobile: player.mobile } });
});

app.get("/api/demo/config",demoPlayerOnly,async(req,res)=>{
 const x=await DemoGameSetting.findOne({key:"global"}).lean()||{enabled:true,minPoints:1,maxPoints:1000000};
 res.setHeader("Cache-Control","no-store").json({enabled:x.enabled,minPoints:x.minPoints,maxPoints:x.maxPoints});
});
app.get("/api/demo/transactions",demoPlayerOnly,async(req,res)=>{
 const transactions=await DemoWalletTransaction.find({playerId:req.demoPlayer.id}).sort({createdAt:-1}).limit(200).lean();
 res.setHeader("Cache-Control","no-store").json({transactions});
});
app.get("/api/demo/notifications",demoPlayerOnly,async(req,res)=>{
 const [tx,plays]=await Promise.all([
  DemoWalletTransaction.find({playerId:req.demoPlayer.id}).sort({createdAt:-1}).limit(30).lean(),
  DemoPlay.find({playerId:req.demoPlayer.id,status:{$in:["WIN","NO MATCH"]}}).sort({resolvedAt:-1}).limit(30).lean()
 ]);
 const notifications=[...tx.map(x=>({title:x.type==="CREDIT"?"Wallet में Points जुड़े":"Wallet से Points कटे",detail:x.reason+" · "+x.amount+" Points",createdAt:x.createdAt})),...plays.map(x=>({title:x.status==="WIN"?"आपकी Demo Play जीत गई":"Demo Play का Result आ गया",detail:x.market+" · "+x.number+" · "+x.status,createdAt:x.resolvedAt||x.createdAt}))].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,50);
 res.setHeader("Cache-Control","no-store").json({notifications});
});
app.get("/api/demo/leaderboard",demoPlayerOnly,async(req,res)=>{
 const rows=await DemoPlayer.find({status:"approved"}).select("name walletPoints").sort({walletPoints:-1,name:1}).limit(20).lean();
 res.setHeader("Cache-Control","no-store").json({leaderboard:rows.map((p,i)=>({rank:i+1,name:p.name,points:Number(p.walletPoints||0)}))});
});
app.get("/api/demo/results",demoPlayerOnly,async(req,res)=>{
 const results=await Result.find({published:true,deleted:{$ne:true}}).select("title resultText resultDate").sort({resultDate:-1}).limit(100).lean();
 res.setHeader("Cache-Control","no-store").json({results});
});
app.get("/api/demo/me", demoPlayerOnly, async (req, res) => {
  const player = await DemoPlayer.findById(req.demoPlayer.id).select("name mobile walletPoints").lean();
  res.setHeader("Cache-Control", "no-store").json({ ok: true, player: { ...req.demoPlayer, walletPoints: Number(player?.walletPoints || 0) } });
});

app.get("/api/demo/plays", demoPlayerOnly, async (req, res) => {
  const [player, plays] = await Promise.all([
    DemoPlayer.findById(req.demoPlayer.id).select("walletPoints").lean(),
    DemoPlay.find({ playerId: req.demoPlayer.id }).sort({ createdAt: -1 }).limit(200).lean()
  ]);
  res.setHeader("Cache-Control", "no-store").json({ ok: true, walletPoints: Number(player?.walletPoints || 0), plays });
});

app.post("/api/demo/plays", demoPlayerOnly, async (req, res) => {
  const market = String(req.body?.market || "").trim();
  const rawNumbers = Array.isArray(req.body?.numbers) ? req.body.numbers : [req.body?.number];
  const numbers = [...new Set(rawNumbers.filter(v => v !== undefined && v !== null && String(v).trim() !== "").map(v => String(v).trim().padStart(2, "0")))];
  const rawLines = Array.isArray(req.body?.lines) ? req.body.lines : [];
  const lines = [...new Set(rawLines.map(Number))];
  const points = Number(req.body?.points);
  const setting = await DemoGameSetting.findOne({ key: "global" }).lean() || { enabled: true, minPoints: 1, maxPoints: 1000000 };
  if (!setting.enabled) return res.status(403).json({ error: "Demo Game अभी Admin ने बंद किया है।" });
  if (market.length < 2 || market.length > 80) return res.status(400).json({ error: "सही मार्केट चुनें।" });
  if (numbers.length + lines.length < 1 || numbers.length + lines.length > 100 || numbers.some(n => !/^\d{2}$/.test(n) || Number(n) > 99) || lines.some(n => !Number.isInteger(n) || n < 1 || n > 9)) return res.status(400).json({ error: "00 से 99 के नंबर या 1 से 9 तक की सही लाइन चुनें।" });
  if (!Number.isSafeInteger(points) || points < Number(setting.minPoints || 1) || points > Number(setting.maxPoints || 1000000)) return res.status(400).json({ error: "हर नंबर/लाइन के Points सीमा " + setting.minPoints + " से " + setting.maxPoints + " के बीच रखें।" });
  const selections = [...numbers.map(number => ({ number, playType: "NUMBER", lineDigit: null })), ...lines.map(lineDigit => ({ number: String(lineDigit).padStart(2, "0"), playType: "LINE", lineDigit }))];
  const totalPoints = points * selections.length;
  if (!Number.isSafeInteger(totalPoints) || totalPoints > 100000000) return res.status(400).json({ error: "कुल Points सीमा से अधिक हैं।" });
  const playDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  for (const selection of selections) {
    const q = { playerId: req.demoPlayer.id, market, playDate, status: "PENDING", playType: selection.playType, number: selection.number };
    if (selection.playType === "LINE") q.lineDigit = selection.lineDigit;
    const old = await DemoPlay.findOne(q).sort({ createdAt: 1 }).lean();
    if (old && Number(old.points || 0) + points > 1000000) return res.status(400).json({ error: "इस नंबर/लाइन पर कुल Pending Play Points 10,00,000 से अधिक हो जाएंगे।" });
  }
  const player = await DemoPlayer.findOneAndUpdate({ _id: req.demoPlayer.id, status: "approved", walletPoints: { $gte: totalPoints } }, { $inc: { walletPoints: -totalPoints } }, { new: true }).select("walletPoints").lean();
  if (!player) return res.status(400).json({ error: "आपके Demo Wallet में कुल " + totalPoints + " Points नहीं हैं या account active नहीं है।" });
  const changes = [], transactionIds = [];
  try {
    for (const selection of selections) {
      const q = { playerId: req.demoPlayer.id, market, playDate, status: "PENDING", playType: selection.playType, number: selection.number };
      if (selection.playType === "LINE") q.lineDigit = selection.lineDigit;
      const matching = await DemoPlay.findOne(q).sort({ createdAt: 1 }).lean();
      let play;
      if (matching) {
        play = await DemoPlay.findOneAndUpdate({ _id: matching._id, playerId: req.demoPlayer.id, status: "PENDING" }, { $inc: { points } }, { new: true });
        if (!play) throw new Error("नंबर/लाइन की Play अपडेट नहीं हो पाई।");
        changes.push({ id: play._id, added: points, created: false });
      } else {
        play = await DemoPlay.create({ playerId: req.demoPlayer.id, market, number: selection.number, playType: selection.playType, lineDigit: selection.lineDigit, points, playDate });
        changes.push({ id: play._id, added: points, created: true });
      }
      const label = selection.playType === "LINE" ? "Line " + selection.lineDigit : selection.number;
      const tx = await DemoWalletTransaction.create({ playerId: req.demoPlayer.id, type: "DEBIT", amount: points, reason: "Demo Play · " + market + " · " + label });
      transactionIds.push(tx._id);
    }
    res.status(201).json({ ok: true, walletPoints: player.walletPoints, count: selections.length, totalPoints, mergedCount: changes.filter(x => !x.created).length });
  } catch (error) {
    for (const item of changes.reverse()) {
      if (item.created) await DemoPlay.deleteOne({ _id: item.id, playerId: req.demoPlayer.id });
      else await DemoPlay.updateOne({ _id: item.id, playerId: req.demoPlayer.id }, { $inc: { points: -item.added } });
    }
    if (transactionIds.length) await DemoWalletTransaction.deleteMany({ _id: { $in: transactionIds }, playerId: req.demoPlayer.id });
    await DemoPlayer.updateOne({ _id: req.demoPlayer.id }, { $inc: { walletPoints: totalPoints } });
    throw error;
  }
});

app.post("/api/demo/settle", demoPlayerOnly, async (req, res) => {
  const pending = await DemoPlay.find({ playerId: req.demoPlayer.id, status: "PENDING" }).sort({ createdAt: 1 }).limit(200).lean();
  if (pending.length) {
    const markets = [...new Set(pending.map(p => p.market))];
    const dates = [...new Set(pending.map(p => p.playDate))];
    const startDate = dates.sort()[0];
    const endDate = dates.sort().slice(-1)[0];
    const start = new Date(startDate + "T00:00:00.000Z");
    const end = new Date(new Date(endDate + "T00:00:00.000Z").getTime() + 86400000);
    const results = await Result.find({
      published: true, deleted: { $ne: true }, title: { $in: markets }, resultDate: { $gte: new Date(start.getTime() - 86400000), $lt: new Date(end.getTime() + 86400000) }
    }).select("title resultText resultDate").lean();
    const dateKey = value => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
    const pairs = value => String(value ?? "").match(/\d{2}/g) || [];
    for (const play of pending) {
      const result = results.find(r => String(r.title).trim().toLowerCase() === play.market.trim().toLowerCase() && dateKey(r.resultDate) === play.playDate);
      if (!result) continue;
      const resultPairs = pairs(result.resultText);
      const isLine = play.playType === "LINE" && Number.isInteger(Number(play.lineDigit));
      const won = isLine ? resultPairs.some(value => value.endsWith(String(play.lineDigit))) : resultPairs.includes(play.number);
      const updated = await DemoPlay.findOneAndUpdate(
        { _id: play._id, playerId: req.demoPlayer.id, status: "PENDING" },
        { $set: { status: won ? "WIN" : "NO MATCH", result: String(result.resultText || ""), resolvedAt: new Date() } },
        { new: true }
      ).lean();
      if (updated && won) {
        const reward = play.points * (isLine ? 9.7 : 97);
        await DemoPlayer.updateOne({ _id: req.demoPlayer.id }, { $inc: { walletPoints: reward } });
        await DemoWalletTransaction.create({ playerId: req.demoPlayer.id, type: "CREDIT", amount: reward, reason: "Winning reward · " + play.market + " · " + (isLine ? "Line " + play.lineDigit : play.number) });
      }
    }
  }
  const [player, plays] = await Promise.all([
    DemoPlayer.findById(req.demoPlayer.id).select("walletPoints").lean(),
    DemoPlay.find({ playerId: req.demoPlayer.id }).sort({ createdAt: -1 }).limit(200).lean()
  ]);
  res.setHeader("Cache-Control", "no-store").json({ ok: true, walletPoints: Number(player?.walletPoints || 0), plays });
});

app.get("/api/admin/demo-game-settings",adminOnly,async(req,res)=>{
 const x=await DemoGameSetting.findOneAndUpdate({key:"global"},{$setOnInsert:{enabled:true,minPoints:1,maxPoints:1000000}},{upsert:true,new:true,setDefaultsOnInsert:true}).lean();
 res.json({enabled:x.enabled,minPoints:x.minPoints,maxPoints:x.maxPoints});
});
app.patch("/api/admin/demo-game-settings",adminOnly,async(req,res)=>{
 const enabled=req.body?.enabled,minPoints=Number(req.body?.minPoints),maxPoints=Number(req.body?.maxPoints);
 if(typeof enabled!=="boolean")return res.status(400).json({error:"Game On/Off चुनें।"});
 if(!Number.isSafeInteger(minPoints)||!Number.isSafeInteger(maxPoints)||minPoints<1||maxPoints>1000000||maxPoints<minPoints)return res.status(400).json({error:"Points सीमा सही रखें (1 से 10,00,000)।"});
 const x=await DemoGameSetting.findOneAndUpdate({key:"global"},{$set:{enabled,minPoints,maxPoints,updatedAt:new Date()}},{upsert:true,new:true,setDefaultsOnInsert:true}).lean();
 res.json({ok:true,enabled:x.enabled,minPoints:x.minPoints,maxPoints:x.maxPoints});
});
app.get("/api/admin/demo-players", adminOnly, async (req, res) => {
  const rows = await DemoPlayer.find().select("name mobile email status walletPoints createdAt approvedAt").sort({ createdAt: -1 }).lean();
  res.json(rows);
});

app.get("/api/admin/demo-players/:id/ledger", adminOnly, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Demo User ID सही नहीं है।" });
  const month = String(req.query.month || "");
  if (!/^\\d{4}-(0[1-9]|1[0-2])$/.test(month)) return res.status(400).json({ error: "सही महीना चुनें।" });
  const player = await DemoPlayer.findById(req.params.id).select("name mobile").lean();
  if (!player) return res.status(404).json({ error: "Demo User नहीं मिला।" });
  const plays = await DemoPlay.find({ playerId: player._id, playDate: { $regex: "^" + month } }).sort({ playDate: 1, market: 1, createdAt: 1 }).lean();
  const [yearPart, monthPart] = month.split("-").map(Number);
  const start = new Date(Date.UTC(yearPart, monthPart - 1, 1) - 330 * 60 * 1000);
  const nextMonth = new Date(Date.UTC(yearPart, monthPart, 1) - 330 * 60 * 1000);
  const transactions = await DemoWalletTransaction.find({ playerId: player._id, createdAt: { $gte: start, $lt: nextMonth } }).sort({ createdAt: 1 }).lean();
  const marketMap = new Map();
  const totals = { plays: 0, staked: 0, returned: 0, wins: 0, losses: 0, pending: 0, net: 0 };
  for (const play of plays) {
    const marketName = String(play.market || "अन्य");
    if (!marketMap.has(marketName)) marketMap.set(marketName, { market: marketName, days: new Map(), totals: { plays: 0, staked: 0, returned: 0, wins: 0, losses: 0, pending: 0, net: 0 } });
    const market = marketMap.get(marketName);
    if (!market.days.has(play.playDate)) market.days.set(play.playDate, { date: play.playDate, plays: 0, staked: 0, returned: 0, wins: 0, losses: 0, pending: 0, net: 0 });
    const day = market.days.get(play.playDate);
    const returned = play.status === "WIN" ? Number(play.points || 0) * (play.playType === "LINE" ? 9.7 : 97) : 0;
    const loss = play.status === "NO MATCH";
    for (const row of [day, market.totals, totals]) {
      row.plays += 1;
      row.staked += Number(play.points || 0);
      row.returned += returned;
      row.wins += play.status === "WIN" ? 1 : 0;
      row.losses += loss ? 1 : 0;
      row.pending += play.status === "PENDING" ? 1 : 0;
      row.net = row.returned - row.staked;
    }
  }
  const dateFormat = value => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
  const walletTransactions = transactions.map(t => ({ date: dateFormat(t.createdAt), type: t.type, amount: Number(t.amount || 0), reason: t.reason }));
  res.setHeader("Cache-Control", "no-store").json({
    ok: true, player, month, totals,
    markets: [...marketMap.values()].map(m => ({ market: m.market, totals: m.totals, days: [...m.days.values()] })),
    walletTransactions
  });
});

app.post("/api/admin/demo-players/:id/points", adminOnly, async (req, res) => {
  const points = Number(req.body?.points);
  if (!Number.isSafeInteger(points) || points < 1 || points > 1000000) return res.status(400).json({ error: "1 से 10,00,000 तक पूरे Points डालें।" });
  const player = await DemoPlayer.findByIdAndUpdate(req.params.id, { $inc: { walletPoints: points } }, { new: true }).select("name mobile status walletPoints").lean();
  if (!player) return res.status(404).json({ error: "Demo player नहीं मिला।" });
  await DemoWalletTransaction.create({ playerId: player._id, type: "CREDIT", amount: points, reason: "Admin ने Wallet में Points जोड़े" });
  res.json({ ok: true, player });
});

app.delete("/api/admin/demo-players/:id", adminOnly, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Demo User ID सही नहीं है।" });
  const player = await DemoPlayer.findByIdAndDelete(req.params.id).select("_id name mobile").lean();
  if (!player) return res.status(404).json({ error: "Demo User नहीं मिला।" });
  await DemoPlay.deleteMany({ playerId: player._id });
  res.json({ ok: true, message: "Demo User और उसका play history हटाया गया।" });
});

app.patch("/api/admin/demo-players/:id", adminOnly, async (req, res) => {
  const status = String(req.body?.status || "");
  if (!["approved", "rejected", "disabled", "pending"].includes(status)) return res.status(400).json({ error: "सही account status चुनें।" });
  const update = { status, approvedAt: status === "approved" ? new Date() : null };
  const player = await DemoPlayer.findByIdAndUpdate(req.params.id, update, { new: true }).select("name mobile status approvedAt").lean();
  if (!player) return res.status(404).json({ error: "Demo player नहीं मिला।" });
  res.json({ ok: true, player });
});

// Mirror public results to a static GitHub JSON file after successful admin/user changes.
// This lets the public GitHub Pages frontend keep showing the last published data while Render sleeps.
app.use((req, res, next) => {
  res.on("finish", () => {
    const writeMethod = ["POST", "PATCH", "PUT", "DELETE"].includes(req.method);
    const publicDataWrite = /^\/api\/(admin|user)\/(results|cities|city|users|restore)(\/|$)/.test(req.path);
    if (writeMethod && publicDataWrite && res.statusCode >= 200 && res.statusCode < 300) {
      syncPublicSnapshot().catch(err => console.error("Public snapshot sync failed:", err.message));
    }
  });
  next();
});

// Slow repeated admin password guesses from the same client IP.
const adminLoginAttempts = new Map();
const ADMIN_LOGIN_WINDOW_MS = 15 * 60 * 1000;
const ADMIN_LOGIN_MAX_ATTEMPTS = 10;
function adminLoginRateLimit(req, res, next) {
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || "unknown";
  let record = adminLoginAttempts.get(key);
  if (!record || record.resetAt <= now) {
    record = { count: 0, resetAt: now + ADMIN_LOGIN_WINDOW_MS };
  }
  if (record.count >= ADMIN_LOGIN_MAX_ATTEMPTS) {
    res.setHeader("Retry-After", String(Math.max(1, Math.ceil((record.resetAt - now) / 1000))));
    return res.status(429).json({ error: "बहुत बार गलत login प्रयास हुए हैं। 15 मिनट बाद फिर कोशिश करें।" });
  }
  record.count += 1;
  adminLoginAttempts.set(key, record);
  // Keep the in-memory limiter bounded and discard expired entries.
  if (adminLoginAttempts.size > 5000) {
    for (const [ip, item] of adminLoginAttempts) {
      if (item.resetAt <= now || adminLoginAttempts.size > 5000) adminLoginAttempts.delete(ip);
      if (adminLoginAttempts.size <= 4000) break;
    }
  }
  next();
}

app.post("/api/admin/login", adminLoginRateLimit, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password || !process.env.ADMIN_USERNAME || !adminPasswordHash || !process.env.JWT_SECRET)
    return res.status(400).json({ error: "Admin configuration missing" });
  const validUser = username === process.env.ADMIN_USERNAME;
  const validPass = await bcrypt.compare(password, adminPasswordHash);
  if (!validUser || !validPass) return res.status(401).json({ error: "Incorrect login" });
  adminLoginAttempts.delete(req.ip || req.socket.remoteAddress || "unknown");
  const authState = await AdminAuthState.findOneAndUpdate(
    { key: "admin" },
    { $setOnInsert: { sessionVersion: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
  const token = jwt.sign({ role: "admin", sessionVersion: authState.sessionVersion }, process.env.JWT_SECRET, { expiresIn: "12h" });
  res.cookie("admin_session", token, {
    httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production",
    maxAge: 12 * 60 * 60 * 1000, path: "/"
  });
  res.json({ ok: true });
});

app.get("/api/public/announcement",async(req,res)=>{try{const a=await Announcement.findOne().lean();res.setHeader("Cache-Control","no-store");res.json(a&&a.enabled?{title:a.title,message:a.message,enabled:true}:{enabled:false});}catch(e){res.status(503).json({enabled:false});}});
app.get("/api/admin/announcement",adminOnly,async(req,res)=>{const a=await Announcement.findOne().lean();res.json(a||{enabled:false,title:"",message:""});});
app.put("/api/admin/announcement",adminOnly,async(req,res)=>{const {title,message,enabled}=req.body||{};if(!String(message||"").trim())return res.status(400).json({error:"सूचना का message लिखें।"});const a=await Announcement.findOneAndUpdate({},{$set:{title:String(title||"").slice(0,120),message:String(message||"").slice(0,1000),enabled:!!enabled,updatedAt:new Date()}},{upsert:true,new:true,setDefaultsOnInsert:true});res.json({ok:true,enabled:a.enabled});});
app.get("/api/public/poster", async (req,res)=>{try{const p=await Poster.findOne().lean();res.setHeader("Cache-Control","no-store");res.json(p&&p.enabled?{heading:p.heading,description:p.description,buttonText:p.buttonText,buttonUrl:p.buttonUrl,design:p.design||{},enabled:true}:{enabled:false});}catch(e){res.status(503).json({enabled:false});}});
app.get("/api/admin/poster",adminOnly,async(req,res)=>{const p=await Poster.findOne().lean();res.json(p||{enabled:false,heading:"",description:"",buttonText:"",buttonUrl:""});});
app.get("/api/public/popup-ad",async(req,res)=>{try{const p=await PopupAd.findOne().lean();res.setHeader("Cache-Control","no-store");res.json(p?{enabled:!!p.enabled,title:p.title,description:p.description,imageData:p.imageData,buttonText:p.buttonText,buttonUrl:p.buttonUrl,delaySeconds:p.delaySeconds,frequencyMinutes:p.frequencyMinutes}:{enabled:true,title:"👑 Satta king 👑",description:"हमारी वेबसाइट पर आपका स्वागत है। नवीनतम रिजल्ट और अपडेट देखें।",imageData:"",buttonText:"अभी देखें",buttonUrl:"",delaySeconds:0,frequencyMinutes:0});}catch(e){res.status(503).json({enabled:false});}});
app.get("/api/admin/popup-ad",adminOnly,async(req,res)=>{const p=await PopupAd.findOne().lean();res.json(p||{enabled:false,title:"",description:"",imageData:"",buttonText:"अभी देखें",buttonUrl:"",delaySeconds:0,frequencyMinutes:0});});
app.put("/api/admin/popup-ad",adminOnly,async(req,res)=>{const b=req.body||{};const imageData=typeof b.imageData==="string"?b.imageData:"";if(imageData&&(!/^data:image\/(jpeg|png|webp);base64,/i.test(imageData)||imageData.length>7*1024*1024))return res.status(400).json({error:"केवल JPG, PNG या WebP फोटो (5 MB तक) अपलोड करें।"});const buttonUrl=String(b.buttonUrl||"").trim();if(buttonUrl&&!/^https:\/\//i.test(buttonUrl))return res.status(400).json({error:"लिंक https:// से शुरू होना चाहिए।"});const old=await PopupAd.findOne().lean();const p=await PopupAd.findOneAndUpdate({},{$set:{title:String(b.title||"").slice(0,120),description:String(b.description||"").slice(0,500),imageData:imageData||old?.imageData||"",buttonText:String(b.buttonText||"अभी देखें").slice(0,40),buttonUrl:buttonUrl.slice(0,500),delaySeconds:[0,5,10,15].includes(Number(b.delaySeconds))?Number(b.delaySeconds):0,frequencyMinutes:[0,10,20,30].includes(Number(b.frequencyMinutes))?Number(b.frequencyMinutes):0,enabled:!!b.enabled,updatedAt:new Date()}},{upsert:true,new:true});res.json({ok:true,enabled:p.enabled});});

async function ensurePopupAdItems(){
  if(await PopupAdItem.countDocuments())return;
  const legacy=await PopupAd.findOne().lean();
  if(!legacy||(!legacy.title&&!legacy.description&&!legacy.imageData))return;
  await PopupAdItem.create({title:legacy.title||"",description:legacy.description||"",imageData:legacy.imageData||"",buttonText:legacy.buttonText||"अभी देखें",buttonUrl:legacy.buttonUrl||"",delaySeconds:Number(legacy.delaySeconds)||0,frequencyMinutes:Number(legacy.frequencyMinutes)||0,enabled:!!legacy.enabled,createdAt:legacy.updatedAt||new Date(),updatedAt:legacy.updatedAt||new Date()});
}
function validatePopupAdBody(body,res){
  const b=body||{};
  if(typeof b.imageData==="string"&&b.imageData&&(!/^data:image\/(jpeg|png|webp);base64,/i.test(b.imageData)||b.imageData.length>7*1024*1024)){res.status(400).json({error:"केवल JPG, PNG या WebP फोटो (5 MB तक) अपलोड करें।"});return false;}
  const url=String(b.buttonUrl||"").trim();
  if(url&&!/^https:\/\//i.test(url)){res.status(400).json({error:"लिंक https:// से शुरू होना चाहिए।"});return false;}
  return true;
}
app.get("/api/public/popup-ads",async(req,res)=>{try{await ensurePopupAdItems();const ads=await PopupAdItem.find({enabled:true}).sort({createdAt:1,_id:1}).lean();res.setHeader("Cache-Control","no-store");res.json({ads:ads.map(({_id,title,description,imageData,buttonText,buttonUrl,delaySeconds,frequencyMinutes,design})=>({id:String(_id),title,description,imageData,buttonText,buttonUrl,delaySeconds,frequencyMinutes,design:design||{}}))});}catch(e){res.status(503).json({ads:[]});}});
app.get("/api/admin/popup-ads",adminOnly,async(req,res)=>{try{await ensurePopupAdItems();const ads=await PopupAdItem.find().sort({createdAt:1,_id:1}).lean();res.json({ads:ads.map(a=>({...a,id:String(a._id)}))});}catch(e){res.status(500).json({error:"Popup Ads लोड नहीं हो पाए।"});}});
app.post("/api/admin/popup-ads",adminOnly,async(req,res)=>{const b=req.body||{};if(!validatePopupAdBody(b,res))return;const url=String(b.buttonUrl||"").trim();const ad=await PopupAdItem.create({title:String(b.title||"").slice(0,120),description:String(b.description||"").slice(0,500),imageData:String(b.imageData||""),buttonText:String(b.buttonText||"अभी देखें").slice(0,40),buttonUrl:url.slice(0,500),delaySeconds:[0,5,10,15].includes(Number(b.delaySeconds))?Number(b.delaySeconds):0,frequencyMinutes:[0,10,20,30].includes(Number(b.frequencyMinutes))?Number(b.frequencyMinutes):0,design:b.design&&typeof b.design==="object"?b.design:{},enabled:!!b.enabled});res.status(201).json({ok:true,id:String(ad._id)});});
app.put("/api/admin/popup-ads/:id",adminOnly,async(req,res)=>{const b=req.body||{};if(!validatePopupAdBody(b,res))return;if(!mongoose.isValidObjectId(req.params.id))return res.status(400).json({error:"विज्ञापन ID सही नहीं है।"});const update={updatedAt:new Date()};if("title" in b)update.title=String(b.title||"").slice(0,120);if("description" in b)update.description=String(b.description||"").slice(0,500);if(typeof b.imageData==="string"&&b.imageData)update.imageData=b.imageData;if("buttonText" in b)update.buttonText=String(b.buttonText||"अभी देखें").slice(0,40);if("buttonUrl" in b)update.buttonUrl=String(b.buttonUrl||"").trim().slice(0,500);if("delaySeconds" in b)update.delaySeconds=[0,5,10,15].includes(Number(b.delaySeconds))?Number(b.delaySeconds):0;if("frequencyMinutes" in b)update.frequencyMinutes=[0,10,20,30].includes(Number(b.frequencyMinutes))?Number(b.frequencyMinutes):0;if("design" in b)update.design=b.design&&typeof b.design==="object"?b.design:{};if("enabled" in b)update.enabled=!!b.enabled;const ad=await PopupAdItem.findByIdAndUpdate(req.params.id,{$set:update},{new:true});if(!ad)return res.status(404).json({error:"विज्ञापन नहीं मिला।"});res.json({ok:true,enabled:ad.enabled});});
app.delete("/api/admin/popup-ads/:id",adminOnly,async(req,res)=>{if(!mongoose.isValidObjectId(req.params.id))return res.status(400).json({error:"विज्ञापन ID सही नहीं है।"});const ad=await PopupAdItem.findByIdAndDelete(req.params.id);if(!ad)return res.status(404).json({error:"विज्ञापन नहीं मिला।"});res.json({ok:true});});

app.get("/api/public/blink-messages",async(req,res)=>{try{const items=await BlinkMessage.find({enabled:true}).sort({createdAt:1,_id:1}).lean();res.setHeader("Cache-Control","no-store");res.json({messages:items.map(x=>({id:String(x._id),title:x.title,message:x.message,link:x.link||"",backgroundColor:x.backgroundColor,textColor:x.textColor,borderColor:x.borderColor,speed:x.speed}))});}catch(e){res.status(503).json({messages:[]});}});
app.get("/api/admin/blink-messages",adminOnly,async(req,res)=>{try{const items=await BlinkMessage.find().sort({createdAt:1,_id:1}).lean();res.json({messages:items.map(x=>({...x,id:String(x._id)}))});}catch(e){res.status(500).json({error:"Blink Messages लोड नहीं हुए।"});}});
app.post("/api/admin/blink-messages",adminOnly,async(req,res)=>{const b=req.body||{};const message=String(b.message||"").trim();if(!message)return res.status(400).json({error:"मैसेज लिखें।"});const link=String(b.link||"").trim();if(link&&!/^https:\/\//i.test(link))return res.status(400).json({error:"वेबसाइट लिंक https:// से शुरू होना चाहिए।"});const speed=[0.5,0.8,1,1.5,2].includes(Number(b.speed))?Number(b.speed):1;const item=await BlinkMessage.create({title:String(b.title||"").slice(0,100),message:message.slice(0,500),link:link.slice(0,500),backgroundColor:/^#[0-9a-f]{6}$/i.test(b.backgroundColor)?b.backgroundColor:"#20170d",textColor:/^#[0-9a-f]{6}$/i.test(b.textColor)?b.textColor:"#fff0c2",borderColor:/^#[0-9a-f]{6}$/i.test(b.borderColor)?b.borderColor:"#d6ad55",speed,enabled:!!b.enabled});res.status(201).json({ok:true,id:String(item._id)});});
app.put("/api/admin/blink-messages/:id",adminOnly,async(req,res)=>{if(!mongoose.isValidObjectId(req.params.id))return res.status(400).json({error:"मैसेज ID सही नहीं है।"});const b=req.body||{},u={updatedAt:new Date()};if("title" in b)u.title=String(b.title||"").slice(0,100);if("message" in b){u.message=String(b.message||"").trim().slice(0,500);if(!u.message)return res.status(400).json({error:"मैसेज खाली नहीं हो सकता।"});}if("link" in b){u.link=String(b.link||"").trim().slice(0,500);if(u.link&&!/^https:\/\//i.test(u.link))return res.status(400).json({error:"वेबसाइट लिंक https:// से शुरू होना चाहिए।"});}for(const k of ["backgroundColor","textColor","borderColor"])if(k in b)u[k]=/^#[0-9a-f]{6}$/i.test(b[k])?b[k]:"#20170d";if("speed" in b)u.speed=[0.5,0.8,1,1.5,2].includes(Number(b.speed))?Number(b.speed):1;if("enabled" in b)u.enabled=!!b.enabled;const item=await BlinkMessage.findByIdAndUpdate(req.params.id,{$set:u},{new:true});if(!item)return res.status(404).json({error:"मैसेज नहीं मिला।"});res.json({ok:true});});
app.delete("/api/admin/blink-messages/:id",adminOnly,async(req,res)=>{if(!mongoose.isValidObjectId(req.params.id))return res.status(400).json({error:"मैसेज ID सही नहीं है।"});const item=await BlinkMessage.findByIdAndDelete(req.params.id);if(!item)return res.status(404).json({error:"मैसेज नहीं मिला।"});res.json({ok:true});});

app.put("/api/admin/poster",adminOnly,async(req,res)=>{const {heading,description,buttonText,buttonUrl,enabled}=req.body||{};if(!String(heading||"").trim()&&!String(description||"").trim())return res.status(400).json({error:"Ad का message लिखें।"});if(buttonUrl&&!/^https:\/\//i.test(buttonUrl))return res.status(400).json({error:"Button link https:// से शुरू होना चाहिए।"});const p=await Poster.findOneAndUpdate({},{$set:{heading:String(heading||"").slice(0,120),description:String(description||"").slice(0,1000),buttonText:String(buttonText||"").slice(0,50),buttonUrl:String(buttonUrl||"").slice(0,500),design:req.body.design&&typeof req.body.design==="object"?req.body.design:{},enabled:!!enabled,updatedAt:new Date()},$unset:{imageData:1}},{upsert:true,new:true});res.json({ok:true,enabled:p.enabled});});
app.get("/api/admin/session", adminOnly, (req, res) => res.json({ ok: true, role: "admin" }));

function indiaDayStart(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day) - 330 * 60 * 1000);
}
function indiaDateKey(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(date);
}

// Public endpoint: intentionally stores no IP address, cookie, or personal identifier.
app.post("/api/visitor/track", async (req, res) => {
  try {
    const site = req.body?.site;
    const visitorId = req.body?.visitorId;
    if (!["github_pages", "render"].includes(site)) {
      return res.status(400).json({ error: "Invalid visitor source." });
    }
    if (typeof visitorId !== "string" || !/^[a-f0-9-]{20,64}$/i.test(visitorId)) {
      return res.status(400).json({ error: "Invalid visitor identifier." });
    }
    await VisitorVisit.create({ site, visitorId });
    res.setHeader("Cache-Control", "no-store");
    res.status(202).json({ ok: true });
  } catch (error) {
    console.error("Visitor tracking failed:", error.message);
    res.status(503).json({ error: "Visitor tracking temporarily unavailable." });
  }
});

// Heartbeat refreshes active presence; a tab is online while seen in the last 90 seconds.
app.post("/api/visitor/heartbeat", async (req, res) => {
  try {
    const { site, sessionId } = req.body || {};
    if (!["github_pages", "render"].includes(site) || typeof sessionId !== "string" || !/^[a-f0-9-]{20,64}$/i.test(sessionId)) {
      return res.status(400).json({ error: "Invalid online session." });
    }
    await OnlineVisitor.updateOne({ sessionId }, { $set: { site, lastSeen: new Date() } }, { upsert: true });
    res.setHeader("Cache-Control", "no-store");
    res.status(202).json({ ok: true });
  } catch (error) {
    console.error("Online heartbeat failed:", error.message);
    res.status(503).json({ error: "Online status temporarily unavailable." });
  }
});

app.get("/api/public/online", async (req, res) => {
  try {
    const activeSince = new Date(Date.now() - 90 * 1000);
    const count = await OnlineVisitor.countDocuments({ lastSeen: { $gte: activeSince } });
    res.setHeader("Cache-Control", "no-store");
    res.json({ online: count });
  } catch (error) {
    console.error("Online count failed:", error.message);
    res.status(503).json({ online: null });
  }
});

app.get("/api/admin/visitors", adminOnly, async (req, res) => {
  try {
    const todayKey = indiaDateKey(new Date());
    const todayStart = indiaDayStart(todayKey);
    const tomorrowStart = new Date(todayStart.getTime() + 86400000);
    const yesterdayStart = new Date(todayStart.getTime() - 86400000);
    const last7Start = new Date(todayStart.getTime() - 6 * 86400000);
    const last30Start = new Date(todayStart.getTime() - 29 * 86400000);
    const activeStart = new Date(Date.now() - 5 * 60 * 1000);
    const [facet] = await VisitorVisit.aggregate([{
      $facet: {
        totals: [{
          $group: {
            _id: null,
            total: { $sum: 1 },
            today: { $sum: { $cond: [{ $and: [{ $gte: ["$createdAt", todayStart] }, { $lt: ["$createdAt", tomorrowStart] }] }, 1, 0] } },
            yesterday: { $sum: { $cond: [{ $and: [{ $gte: ["$createdAt", yesterdayStart] }, { $lt: ["$createdAt", todayStart] }] }, 1, 0] } },
            last7: { $sum: { $cond: [{ $gte: ["$createdAt", last7Start] }, 1, 0] } },
            last30: { $sum: { $cond: [{ $gte: ["$createdAt", last30Start] }, 1, 0] } }
          }
        }],
        todayBySite: [
          { $match: { createdAt: { $gte: todayStart, $lt: tomorrowStart } } },
          { $group: { _id: "$site", count: { $sum: 1 } } }
        ],
        allBySite: [
          { $group: { _id: "$site", count: { $sum: 1 } } }
        ],
        recent5m: [
          { $match: { createdAt: { $gte: activeStart } } },
          { $count: "count" }
        ],
        daily: [
          { $match: { createdAt: { $gte: last7Start, $lt: tomorrowStart } } },
          { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "Asia/Kolkata" } }, count: { $sum: 1 } } },
          { $sort: { _id: 1 } }
        ]
      }
    }]);
    // Count one anonymous browser identifier once per India calendar day.
    const uniqueDaily = await VisitorVisit.aggregate([
      { $match: { visitorId: { $type: "string", $ne: "" }, createdAt: { $gte: last30Start, $lt: tomorrowStart } } },
      { $group: {
        _id: {
          day: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "Asia/Kolkata" } },
          visitorId: "$visitorId"
        }
      }},
      { $group: { _id: "$_id.day", count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);
    const totals = facet?.totals?.[0] || {};
    const countFor = (rows, key) => rows.find(row => row._id === key)?.count || 0;
    const uniqueToday = countFor(uniqueDaily, todayKey);
    const uniqueYesterday = countFor(uniqueDaily, indiaDateKey(yesterdayStart));
    const uniqueLast7 = uniqueDaily.filter(row => row._id >= indiaDateKey(last7Start) && row._id <= todayKey).reduce((sum, row) => sum + row.count, 0);
    const uniqueLast30 = uniqueDaily.reduce((sum, row) => sum + row.count, 0);
    res.setHeader("Cache-Control", "no-store");
    res.json({
      timezone: "Asia/Kolkata",
      today: totals.today || 0,
      yesterday: totals.yesterday || 0,
      last7: totals.last7 || 0,
      last30: totals.last30 || 0,
      total: totals.total || 0,
      recent5m: facet?.recent5m?.[0]?.count || 0,
      newVisitors: {
        today: uniqueToday,
        yesterday: uniqueYesterday,
        last7: uniqueLast7,
        last30: uniqueLast30,
        daily: uniqueDaily.filter(row => row._id >= indiaDateKey(last7Start))
      },
      sites: {
        github_pages: { today: countFor(facet?.todayBySite || [], "github_pages"), total: countFor(facet?.allBySite || [], "github_pages") },
        render: { today: countFor(facet?.todayBySite || [], "render"), total: countFor(facet?.allBySite || [], "render") }
      },
      daily: facet?.daily || []
    });
  } catch (error) {
    console.error("Visitor analytics failed:", error.message);
    res.status(503).json({ error: "Visitor analytics load nahi ho paya." });
  }
});
app.get("/api/admin/export.xlsx", adminOnly, async (req, res) => {
  const [users, cities, results] = await Promise.all([
    User.find().select("name username mobile email active expiresAt createdAt").lean(),
    City.find().select("cityName expectedTime status userId createdAt reviewedAt").lean(),
    Result.find().select("title resultText resultDate published sourceUrl createdAt updatedAt").sort({ resultDate: -1 }).lean()
  ]);
  const userNames = new Map(users.map(u => [String(u._id), u.username]));
  const workbook = XLSX.utils.book_new();
  const resultRows = results.map(r => ({
    "शहर / मार्केट": r.title,
    "परिणाम": r.resultText,
    "तारीख": r.resultDate ? new Date(r.resultDate).toISOString().slice(0,10) : "",
    "प्रकाशित": r.published ? "हाँ" : "नहीं",
    "सोर्स लिंक": r.sourceUrl || "",
    "बनाया गया": r.createdAt ? new Date(r.createdAt).toISOString() : "",
    "अपडेट": r.updatedAt ? new Date(r.updatedAt).toISOString() : ""
  }));
  const userRows = users.map(u => ({
    "नाम": u.name || "",
    "Username": u.username,
    "Mobile": u.mobile || "",
    "Email": u.email || "",
    "Active": u.active ? "हाँ" : "नहीं",
    "Expiry": u.expiresAt ? new Date(u.expiresAt).toISOString() : "",
    "Created": u.createdAt ? new Date(u.createdAt).toISOString() : ""
  }));
  const cityRows = cities.map(c => ({
    "City": c.cityName,
    "Username": userNames.get(String(c.userId)) || "",
    "Expected Time": c.expectedTime || "",
    "Status": c.status,
    "Created": c.createdAt ? new Date(c.createdAt).toISOString() : "",
    "Reviewed": c.reviewedAt ? new Date(c.reviewedAt).toISOString() : ""
  }));
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(resultRows), "Results");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(userRows), "Users");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(cityRows), "Cities");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", 'attachment; filename="rk-bhai-portal-export.xlsx"');
  res.send(buffer);
});

app.get("/api/admin/backup", adminOnly, async (req, res) => {
  const [users, cities, results] = await Promise.all([
    User.find().lean(), City.find().lean(), Result.find().lean()
  ]);
  const backup = {
    app: "rk-bhai-results-portal",
    version: 1,
    createdAt: new Date().toISOString(),
    collections: { users, cities, results }
  };
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="rk-bhai-backup-' + stamp + '.json"');
  res.send(JSON.stringify(backup));
});

app.post("/api/admin/restore", adminOnly, express.json({ limit: "25mb" }), async (req, res) => {
  const backup = req.body;
  const data = backup && backup.collections;
  if (!backup || backup.app !== "rk-bhai-results-portal" || backup.version !== 1 ||
      !data || !Array.isArray(data.users) || !Array.isArray(data.cities) || !Array.isArray(data.results)) {
    return res.status(400).json({ error: "यह सही 👑 Satta king 👑 backup file नहीं है।" });
  }
  if (data.users.length > 5000 || data.cities.length > 5000 || data.results.length > 20000) {
    return res.status(413).json({ error: "Backup में records की संख्या तय सीमा से अधिक है।" });
  }
  const validId = value => value && /^[a-f\d]{24}$/i.test(String(value));
  if (data.users.some(x => !validId(x._id) || !x.username || !x.passwordHash) ||
      data.cities.some(x => !validId(x._id) || !validId(x.userId) || !x.cityName) ||
      data.results.some(x => !validId(x._id) || !x.title || !x.resultText || !x.resultDate || Number.isNaN(new Date(x.resultDate).getTime()))) {
    return res.status(400).json({ error: "Backup file में कुछ records सही format में नहीं हैं।" });
  }
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await User.deleteMany({}, { session });
      await City.deleteMany({}, { session });
      await Result.deleteMany({}, { session });
      if (data.users.length) await User.insertMany(data.users, { session, ordered: true });
      if (data.cities.length) await City.insertMany(data.cities, { session, ordered: true });
      if (data.results.length) await Result.insertMany(data.results, { session, ordered: true });
    });
    res.json({ ok: true, counts: { users: data.users.length, cities: data.cities.length, results: data.results.length } });
  } catch (err) {
    console.error("Backup restore failed:", err.message);
    res.status(400).json({ error: "Restore नहीं हो पाया। पुराना data सुरक्षित रखने की कोशिश की गई है। Backup file जाँचें।" });
  } finally {
    await session.endSession();
  }
});


app.get("/api/admin/users", adminOnly, async (req, res) => {
  await disableExpiredUsers();
  const users = await User.find().select("name username mobile email active expiresAt createdAt").sort({ createdAt: -1 }).lean();
  const cities = await City.find().lean();
  const citiesByUser = new Map();
  for (const c of cities) {
    const key = String(c.userId);
    if (!citiesByUser.has(key)) citiesByUser.set(key, []);
    citiesByUser.get(key).push({ id: c._id, name: c.cityName, status: c.status });
  }
  res.json(users.map(u => ({ ...u, cities: citiesByUser.get(String(u._id)) || [], city: (citiesByUser.get(String(u._id)) || [])[0] || null })));
});
app.post("/api/admin/users", adminOnly, async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const username = String(req.body?.username || "").trim().toLowerCase();
  const expiresInDays = Number(req.body?.expiresInDays);
  const mobile = String(req.body?.mobile || "").replace(/\D/g, "");
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (name.length < 2 || name.length > 80) return res.status(400).json({ error: "User का पूरा नाम 2 से 80 अक्षर में भरें।" });
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) return res.status(400).json({ error: "Username 3-40 अक्षर का रखें।" });
  if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 3650) return res.status(400).json({ error: "Active days 1 से 3650 के बीच चुनें।" });
  if (!/^[6-9]\d{9}$/.test(mobile)) return res.status(400).json({ error: "सही 10 अंकों का भारतीय मोबाइल नंबर भरें।" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "सही Email ID भरें।" });
  if (await User.exists({ $or: [{ username }, { mobile }, { email }] })) return res.status(409).json({ error: "Username, mobile या email पहले से मौजूद है।" });
  const expiresAt = new Date(Date.now() + expiresInDays * 86400000);
  const user = await User.create({ name, username, mobile, email, expiresAt, passwordHash: await bcrypt.hash("userlogin", 12), mustChangePassword: true });
  res.status(201).json({ id: user._id, name: user.name, username: user.username, mobile: user.mobile, email: user.email, active: user.active, expiresAt: user.expiresAt, defaultPassword: "userlogin", createdAt: user.createdAt });
});
app.patch("/api/admin/users/:id", adminOnly, async (req, res) => {
  const update = {};
  if (typeof req.body?.active === "boolean") update.active = req.body.active;
  if (req.body?.clearExpiry === true) update.expiresAt = null;
  if (req.body?.extendByDays !== undefined) {
    const days = Number(req.body.extendByDays);
    if (!Number.isInteger(days) || days < 1 || days > 3650)
      return res.status(400).json({ error: "अतिरिक्त दिन 1 से 3650 के बीच रखें।" });
    const existingExpiry = await User.findById(req.params.id).select("expiresAt");
    if (!existingExpiry) return res.status(404).json({ error: "User नहीं मिला।" });
    const currentExpiry = existingExpiry.expiresAt && existingExpiry.expiresAt > new Date()
      ? existingExpiry.expiresAt
      : new Date();
    update.expiresAt = new Date(currentExpiry.getTime() + days * 86400000);
    update.active = true;
  }
  if (req.body?.expiresInDays !== undefined) {
    const days = Number(req.body.expiresInDays);
    if (!Number.isInteger(days) || days < 1 || days > 3650) return res.status(400).json({ error: "दिन 1 से 3650 के बीच रखें।" });
    update.expiresAt = new Date(Date.now() + days * 86400000);
    update.active = true;
  }
  if (req.body?.expiresAt !== undefined) {
    const date = new Date(req.body.expiresAt);
    if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) return res.status(400).json({ error: "भविष्य की सही तारीख चुनें।" });
    update.expiresAt = date;
    update.active = true;
  }
  if (req.body?.resetPassword === true) {
    update.passwordHash = await bcrypt.hash("userlogin", 12);
    update.mustChangePassword = true;
  } else if (req.body?.password) {
    const password = String(req.body.password);
    if (password.length < 8 || password.length > 100) return res.status(400).json({ error: "Password कम से कम 8 अक्षर का रखें।" });
    update.passwordHash = await bcrypt.hash(password, 12);
    update.mustChangePassword = true;
  }
  const user = await User.findByIdAndUpdate(req.params.id, update, { new: true }).select("username active expiresAt createdAt");
  if (!user) return res.status(404).json({ error: "User नहीं मिला।" });
  res.json(user);
});
app.delete("/api/admin/users/:id", adminOnly, async (req, res) => {
  const user = await User.findByIdAndDelete(req.params.id);
  if (!user) return res.status(404).json({ error: "User नहीं मिला।" });
  const cities = await City.find({ userId: user._id }).select("_id").lean();
  const cityIds = cities.map(c => c._id);
  if (cityIds.length) {
    await City.deleteMany({ userId: user._id });
    await Result.updateMany({ cityId: { $in: cityIds } }, { $set: { deleted: true, published: false } });
  }
  res.json({ ok: true });
});
app.get("/api/user/city", userOnly, async (req, res) => {
  const city = await City.findOne({ userId: req.portalUserId }).lean();
  res.json(city ? { id: city._id, cityName: city.cityName, expectedTime: city.expectedTime || "", status: city.status } : null);
});
app.post("/api/user/city", userOnly, async (req, res) => {
  const cityName = String(req.body?.cityName || "").trim().replace(/\s+/g, " ");
  const expectedTime = String(req.body?.expectedTime || "");
  if (cityName.length < 2 || cityName.length > 60) return res.status(400).json({ error: "शहर का नाम 2 से 60 अक्षर का रखें।" });
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(expectedTime)) return res.status(400).json({ error: "परिणाम आने का सही समय चुनें।" });
  if (await City.exists({ userId: req.portalUserId })) return res.status(409).json({ error: "आप एक ही शहर बना सकते हैं।" });
  let city;
  try {
    city = await City.create({ userId: req.portalUserId, cityName, expectedTime, status: "pending" });
  } catch (error) {
    // A rapid double tap can pass the pre-check twice; the unique userId index
    // is the final guard and should return a normal conflict instead of an error.
    if (error && error.code === 11000) return res.status(409).json({ error: "आप एक ही शहर बना सकते हैं।" });
    throw error;
  }
  res.status(201).json({ id: city._id, cityName: city.cityName, expectedTime: city.expectedTime, status: city.status });
});
app.patch("/api/user/city/name", userOnly, async (req, res) => {
  const cityName = String(req.body?.cityName || "").trim().replace(/\s+/g, " ");
  const expectedTime = String(req.body?.expectedTime || "");
  if (cityName.length < 2 || cityName.length > 60) return res.status(400).json({ error: "शहर का नाम 2 से 60 अक्षर का रखें।" });
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(expectedTime)) return res.status(400).json({ error: "परिणाम आने का सही समय चुनें।" });
  const city = await City.findOneAndUpdate({ userId: req.portalUserId, status: "returned" }, { cityName, expectedTime, status: "pending", reviewedAt: null }, { new: true });
  if (!city) return res.status(403).json({ error: "नाम edit करने के लिए Admin का Send Back जरूरी है।" });
  res.json({ id: city._id, cityName: city.cityName, expectedTime: city.expectedTime, status: city.status });
});
app.patch("/api/user/city/time", userOnly, async (req, res) => {
  const expectedTime = String(req.body?.expectedTime || "");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(expectedTime)) return res.status(400).json({ error: "परिणाम आने का सही समय चुनें।" });
  const city = await City.findOneAndUpdate({ userId: req.portalUserId }, { expectedTime }, { new: true });
  if (!city) return res.status(404).json({ error: "आपका शहर नहीं मिला।" });
  res.json({ id: city._id, cityName: city.cityName, expectedTime: city.expectedTime, status: city.status });
});
app.get("/api/user/results", userOnly, async (req, res) => {
  // Backfill older admin-entered rows for this user's approved city.
  const city = await City.findOne({ userId: req.portalUserId, status: "approved" }).lean();
  if (city) {
    await Result.updateMany({
      title: city.cityName,
      deleted: { $ne: true },
      $or: [{ ownerUserId: null }, { ownerUserId: { $exists: false } }]
    }, { $set: { ownerUserId: req.portalUserId, cityId: city._id } });
  }
  const rows = await Result.find({ ownerUserId: req.portalUserId, deleted: { $ne: true } }).sort({ resultDate: -1 }).limit(500).lean();
  res.setHeader("Cache-Control", "no-store");
  res.json(rows);
});
app.post("/api/user/results", userOnly, async (req, res) => {
  const city = await City.findOne({ userId: req.portalUserId, status: "approved" });
  if (!city) return res.status(403).json({ error: "पहले अपने शहर की Admin approval करवाएँ।" });
  const resultText = String(req.body?.resultText || "").trim();
  const resultDate = req.body?.resultDate;
  if (!resultText || resultText.length > 300 || !resultDate || Number.isNaN(Date.parse(resultDate)))
    return res.status(400).json({ error: "सही परिणाम और तारीख भरें।" });
  const submittedDate = new Date(resultDate);
  const dayStart = new Date(Date.UTC(submittedDate.getUTCFullYear(), submittedDate.getUTCMonth(), submittedDate.getUTCDate()));
  const dayEnd = new Date(dayStart.getTime() + 86400000);
  const duplicate = await Result.exists({ cityId: city._id, deleted: { $ne: true }, resultDate: { $gte: dayStart, $lt: dayEnd } });
  if (duplicate) return res.status(409).json({ error: "इस शहर की इस तारीख का परिणाम पहले से मौजूद है। पुराने रिकॉर्ड को edit करें।" });
  const row = await Result.create({ title: city.cityName, resultText, resultDate, sourceUrl: String(req.body?.sourceUrl || "").slice(0, 500), published: true, ownerUserId: req.portalUserId, cityId: city._id });
  res.status(201).json(row);
});
app.patch("/api/user/results/:id", userOnly, async (req, res) => {
  const city = await City.findOne({ userId: req.portalUserId, status: "approved" });
  if (!city) return res.status(403).json({ error: "आपके शहर की approval active नहीं है।" });
  const row = await Result.findOne({ _id: req.params.id, ownerUserId: req.portalUserId, deleted: { $ne: true } });
  if (!row) return res.status(404).json({ error: "आपका रिकॉर्ड नहीं मिला।" });
  if (req.body?.resultText !== undefined) {
    const value = String(req.body.resultText).trim();
    if (!value || value.length > 300) return res.status(400).json({ error: "परिणाम 1 से 300 अक्षर का रखें।" });
    row.resultText = value;
  }
  if (req.body?.resultDate !== undefined) {
    const nextDate = new Date(req.body.resultDate);
    if (Number.isNaN(nextDate.getTime())) return res.status(400).json({ error: "सही तारीख चुनें।" });
    const dayStart = new Date(Date.UTC(nextDate.getUTCFullYear(), nextDate.getUTCMonth(), nextDate.getUTCDate()));
    const dayEnd = new Date(dayStart.getTime() + 86400000);
    const duplicate = await Result.exists({ _id: { $ne: row._id }, cityId: city._id, deleted: { $ne: true }, resultDate: { $gte: dayStart, $lt: dayEnd } });
    if (duplicate) return res.status(409).json({ error: "इस शहर की इस तारीख का परिणाम पहले से मौजूद है।" });
    row.resultDate = nextDate;
  }
  if (req.body?.sourceUrl !== undefined) row.sourceUrl = String(req.body.sourceUrl).slice(0, 500);
  await row.save();
  res.json(row);
});

app.post("/api/user/login", async (req, res) => {
  const username = String(req.body?.username || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const user = await User.findOne({ username, active: true, $or: [{ expiresAt: null }, { expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }] });
  if (!user || !(await bcrypt.compare(password, user.passwordHash)))
    return res.status(401).json({ error: "गलत username या password, या account बंद है।" });
  const token = jwt.sign({ role: "user", sub: String(user._id) }, process.env.JWT_SECRET, { expiresIn: "7d" });
  res.cookie("user_session", token, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", maxAge: 7 * 24 * 60 * 60 * 1000, path: "/" });
  res.json({ ok: true, name: user.name || user.username, username: user.username, mustChangePassword: user.mustChangePassword, expiresAt: user.expiresAt || null });
});
app.get("/api/user/session", async (req, res) => {
  try {
    const payload = jwt.verify(req.cookies.user_session, process.env.JWT_SECRET);
    if (payload.role !== "user") throw new Error("Invalid role");
    const user = await User.findById(payload.sub).select("name username active mustChangePassword expiresAt").lean();
    if (!user || !user.active || (user.expiresAt && user.expiresAt <= new Date())) return res.status(401).json({ error: "Account बंद है या इसकी अवधि समाप्त हो गई है। Admin से दोबारा approval लें।" });
    res.json({ ok: true, role: "user", name: user.name || user.username, username: user.username, mustChangePassword: !!user.mustChangePassword, expiresAt: user.expiresAt || null });
  } catch { return res.status(401).json({ error: "Login required" }); }
});
app.post("/api/user/change-password", async (req, res) => {
  try {
    const payload = jwt.verify(req.cookies.user_session, process.env.JWT_SECRET);
    if (payload.role !== "user") throw new Error("Invalid role");
    const user = await User.findById(payload.sub);
    if (!user || !user.active) return res.status(401).json({ error: "Account बंद है।" });
    const currentPassword = String(req.body?.currentPassword || "");
    const newPassword = String(req.body?.newPassword || "");
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) return res.status(400).json({ error: "मौजूदा password सही नहीं है।" });
    if (newPassword.length < 8 || newPassword.length > 100) return res.status(400).json({ error: "नया password कम से कम 8 अक्षर का रखें।" });
    if (currentPassword === newPassword) return res.status(400).json({ error: "नया password पुराने password से अलग रखें।" });
    user.passwordHash = await bcrypt.hash(newPassword, 12);
    user.mustChangePassword = false;
    await user.save();
    res.json({ ok: true });
  } catch { return res.status(401).json({ error: "Login session समाप्त हो गई।" }); }
});
app.post("/api/user/logout", (req, res) => {
  res.clearCookie("user_session", { path: "/", sameSite: "strict", secure: process.env.NODE_ENV === "production" });
  res.json({ ok: true });
});


app.post("/api/admin/logout", adminOnly, async (req, res) => {
  await AdminAuthState.findOneAndUpdate({ key: "admin" }, { $inc: { sessionVersion: 1 } }, { upsert: true, setDefaultsOnInsert: true });
  res.clearCookie("admin_session", { path: "/", sameSite: "strict", secure: process.env.NODE_ENV === "production" });
  res.json({ ok: true, message: "Admin session revoked. Login again." });
});

app.get("/api/public/cities", async (req, res) => {
  // Include approved city records and legacy/global published result titles.
  // A city hidden/rejected by admin is not reintroduced from its linked results.
  const [approved, globalTitles] = await Promise.all([
    City.find({ status: "approved" }).select("cityName expectedTime").lean(),
    Result.distinct("title", {
      published: true, deleted: { $ne: true },
      $or: [{ ownerUserId: null }, { ownerUserId: { $exists: false } }]
    })
  ]);
  const byName = new Map();
  for (const c of approved) byName.set(String(c.cityName).trim().toLocaleLowerCase("en"), { cityName: c.cityName, expectedTime: c.expectedTime || "" });
  for (const title of globalTitles) {
    const key = String(title || "").trim().toLocaleLowerCase("en");
    if (key && !byName.has(key)) byName.set(key, { cityName: String(title).trim(), expectedTime: "" });
  }
  res.setHeader("Cache-Control", "no-store");
  res.json([...byName.values()].sort((a,b) => a.cityName.localeCompare(b.cityName)));
});
app.get("/api/public/export.csv", async (req, res) => {
  // Published results remain visible for every admin-approved city, regardless of owner expiry.
  const approvedCityIds = await City.find({ status: "approved" }).distinct("_id");
  const filter = { published: true, deleted: { $ne: true }, $or: [{ ownerUserId: null }, { ownerUserId: { $exists: false } }, { cityId: { $in: approvedCityIds } }] };
  const rows = await Result.find(filter).select("title resultText resultDate sourceUrl").sort({ resultDate: -1, title: 1 }).limit(20000).lean();
  const cell = value => {
    let text = String(value ?? "");
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  const lines = [["शहर / मार्केट", "परिणाम", "तारीख", "सोर्स लिंक"].map(cell).join(",")];
  for (const row of rows) lines.push([row.title, row.resultText, row.resultDate ? new Date(row.resultDate).toISOString().slice(0, 10) : "", row.sourceUrl || ""].map(cell).join(","));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="rk-bhai-published-history.csv"');
  res.send("\uFEFF" + lines.join("\r\n"));
});

app.get("/api/results", async (req, res) => {
  // Published results remain visible for every admin-approved city, regardless of owner expiry.
  const approvedCityIds = await City.find({ status: "approved" }).distinct("_id");
  const filter = { published: true, deleted: { $ne: true }, $or: [{ ownerUserId: null }, { ownerUserId: { $exists: false } }, { cityId: { $in: approvedCityIds } }] };
  if (req.query.recent === "2") {
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit"
    }).format(new Date());
    const todayStart = new Date(today + "T00:00:00.000Z");
    const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
    const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
    filter.resultDate = { $gte: yesterdayStart, $lt: tomorrowStart };
  } else if (req.query.today === "1") {
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit"
    }).format(new Date());
    const start = new Date(today + "T00:00:00.000Z");
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    filter.resultDate = { $gte: start, $lt: end };
  }
  if (req.query.date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(req.query.date))
      return res.status(400).json({ error: "Invalid date. Use YYYY-MM-DD." });
    const start = new Date(req.query.date + "T00:00:00.000Z");
    if (Number.isNaN(start.getTime())) return res.status(400).json({ error: "Invalid date." });
    filter.resultDate = { $gte: start, $lt: new Date(start.getTime() + 86400000) };
  }
  if (req.query.month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(req.query.month))
      return res.status(400).json({ error: "Invalid month. Use YYYY-MM." });
    const [year, month] = req.query.month.split("-").map(Number);
    filter.resultDate = { $gte: new Date(Date.UTC(year, month - 1, 1)), $lt: new Date(Date.UTC(year, month, 1)) };
  }
  const query = Result.find(filter).sort({ resultDate: -1 });
  const rows = req.query.month ? await query.limit(500).lean() : await query.limit(100).lean();
  res.json(rows);
});
app.get("/api/admin/cities", adminOnly, async (req, res) => {
  const cities = await City.find().sort({ createdAt: -1 }).lean();
  const users = await User.find({ _id: { $in: cities.map(c => c.userId) } }).select("username").lean();
  const names = new Map(users.map(u => [String(u._id), u.username]));
  res.json(cities.map(c => ({ ...c, username: names.get(String(c.userId)) || "Unknown" })));
});
app.post("/api/admin/chart-city/assign-any", adminOnly, async (req, res) => {
  const cityName = String(req.body?.cityName || "").trim().replace(/\s+/g, " ");
  const identifier = String(req.body?.username || req.body?.name || "").trim();
  if (cityName.length < 2 || cityName.length > 60) return res.status(400).json({ error: "Chart में दिखने वाला सही City/Market नाम लिखें।" });
  if (!identifier || identifier.length > 80) return res.status(400).json({ error: "User का नाम या Username लिखें।" });
  const lookup = identifier.toLowerCase();
  const matches = await User.find({ $or: [{ username: lookup }, { $expr: { $eq: [{ $toLower: "$name" }, lookup] } }] }).select("_id name username active expiresAt").limit(2).lean();
  if (!matches.length) return res.status(404).json({ error: "इस नाम/Username से कोई User नहीं मिला।" });
  if (matches.length > 1) return res.status(409).json({ error: "एक से अधिक User मिले। कृपया exact Username डालें।" });
  const target = matches[0];
  if (!target.active || (target.expiresAt && target.expiresAt <= new Date())) return res.status(403).json({ error: "इस User का account बंद है या अवधि समाप्त है।" });
  const resultRows = await Result.find({ deleted: { $ne: true } }).select("title").lean();
  const normalized = cityName.toLocaleLowerCase("en").trim();
  const matchedTitles = [...new Set(resultRows.map(r => String(r.title || "").trim()).filter(t => t.toLocaleLowerCase("en") === normalized))];
  if (!matchedTitles.length) return res.status(404).json({ error: "इस नाम से Chart में कोई पुराना Result नहीं मिला। नाम की spelling जाँचें।" });
  const resultFilter = { title: matchedTitles[0], deleted: { $ne: true } };
  const matchedResults = await Result.countDocuments(resultFilter);
  const matchingCities = await City.find({ cityName: matchedTitles[0] });
  if (matchingCities.length > 1) return res.status(409).json({ error: "इस City के एक से अधिक owner records मिले। पहले जाँच जरूरी है।" });
  const city = matchingCities[0] || null;
  const assignedCity = city || new City({ userId: target._id, cityName: matchedTitles[0], expectedTime: "", status: "approved" });
  assignedCity.userId = target._id; assignedCity.status = "approved"; assignedCity.reviewedAt = new Date();
  await assignedCity.save();
  const moved = await Result.updateMany(resultFilter, { $set: { cityId: assignedCity._id, ownerUserId: target._id, published: true } });
  res.json({ ok: true, cityName: assignedCity.cityName, name: target.name || target.username, username: target.username, movedResults: moved.modifiedCount || 0, matchedResults });
});
app.post("/api/admin/cities/:id/assign", adminOnly, async (req, res) => {
  const identifier = String(req.body?.username || req.body?.name || "").trim();
  if (!identifier || identifier.length > 80) return res.status(400).json({ error: "Sandeep का सही नाम या Username भरें।" });
  const city = await City.findById(req.params.id);
  if (!city) return res.status(404).json({ error: "City नहीं मिली।" });
  if (city.cityName.trim().toLowerCase() !== "chandigarh city") {
    return res.status(403).json({ error: "यह assignment सुविधा केवल Chandigarh City के लिए है।" });
  }
  const lookup = identifier.toLowerCase();
  const matches = await User.find({
    $or: [{ username: lookup }, { $expr: { $eq: [{ $toLower: "$name" }, lookup] } }]
  }).select("_id name username active expiresAt").limit(2).lean();
  if (!matches.length) return res.status(404).json({ error: "इस नाम/Username से कोई User नहीं मिला।" });
  if (matches.length > 1) return res.status(409).json({ error: "एक से अधिक User मिले। Sandeep का exact Username डालें।" });
  const target = matches[0];
  if (!target.active || (target.expiresAt && target.expiresAt <= new Date())) {
    return res.status(403).json({ error: "Sandeep का account बंद है या अवधि समाप्त है। पहले account चालू करें।" });
  }
  city.userId = target._id;
  city.status = "approved";
  city.reviewedAt = new Date();
  await city.save();
  const moved = await Result.updateMany(
    { cityId: city._id, deleted: { $ne: true } },
    { $set: { ownerUserId: target._id, published: true, title: city.cityName } }
  );
  res.json({ ok: true, cityName: city.cityName, name: target.name || target.username, username: target.username, movedResults: moved.modifiedCount || 0 });
});
app.patch("/api/admin/cities/:id", adminOnly, async (req, res) => {
  const update = {};
  if (req.body?.status !== undefined) {
    if (!["approved", "rejected", "returned", "hidden", "pending"].includes(req.body.status)) return res.status(400).json({ error: "Invalid city status" });
    update.status = req.body.status;
    update.reviewedAt = new Date();
  }
  if (req.body?.cityName !== undefined) {
    const cityName = String(req.body.cityName).trim().replace(/\s+/g, " ");
    if (cityName.length < 2 || cityName.length > 60) return res.status(400).json({ error: "शहर का नाम 2 से 60 अक्षर का रखें।" });
    update.cityName = cityName;
  }
  const city = await City.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
  if (!city) return res.status(404).json({ error: "City request नहीं मिली।" });
  if (req.body?.status === "approved") {
    // Approving or unhiding a city must restore its non-deleted historical results to the public archive.
    await Result.updateMany({ cityId: city._id, deleted: { $ne: true } }, { $set: { published: true } });
  } else if (req.body?.status) {
    await Result.updateMany({ cityId: city._id }, { $set: { published: false } });
  }
  if (req.body?.cityName) await Result.updateMany({ cityId: city._id }, { $set: { title: city.cityName } });
  res.json(city);
});
app.delete("/api/admin/cities/:id", adminOnly, async (req, res) => {
  const city = await City.findByIdAndDelete(req.params.id);
  if (!city) return res.status(404).json({ error: "City नहीं मिला।" });
  await Result.updateMany({ cityId: city._id }, { $set: { published: false, deleted: true } });
  res.json({ ok: true });
});

app.get("/api/admin/results", adminOnly, async (req, res) => {
  try {
    const filter = { deleted: { $ne: true } };
    if (req.query.month) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(req.query.month))
        return res.status(400).json({ error: "Invalid month. Use YYYY-MM." });
      const [year, month] = req.query.month.split("-").map(Number);
      filter.resultDate = { $gte: new Date(Date.UTC(year, month - 1, 1)), $lt: new Date(Date.UTC(year, month, 1)) };
    }
    const rows = await Result.find(filter).sort({ resultDate: -1, title: 1 }).limit(2000).maxTimeMS(15000).lean();
    res.setHeader("Cache-Control", "no-store");
    res.json(rows);
  } catch (err) {
    console.error("Admin results load failed:", err.message);
    res.status(503).json({ error: "रिकॉर्ड लोड नहीं हो पाए। कुछ देर बाद Refresh करें।" });
  }
});
app.post("/api/admin/results", adminOnly, async (req, res) => {
  const { title, resultText, resultDate, published, sourceUrl } = req.body || {};
  if (!title || !resultText || !resultDate || Number.isNaN(Date.parse(resultDate)))
    return res.status(400).json({ error: "Title, result and valid date are required" });
  const submittedDate = new Date(resultDate);
  const dayStart = new Date(Date.UTC(submittedDate.getUTCFullYear(), submittedDate.getUTCMonth(), submittedDate.getUTCDate()));
  const dayEnd = new Date(dayStart.getTime() + 86400000);
  const cleanTitle = String(title).trim();
  const duplicate = await Result.exists({ title: cleanTitle, deleted: { $ne: true }, resultDate: { $gte: dayStart, $lt: dayEnd } });
  if (duplicate) return res.status(409).json({ error: "इस शहर/मार्केट का इस तारीख का रिकॉर्ड पहले से मौजूद है। पुराने रिकॉर्ड को edit करें।" });
  // Automatically attach the result to the user who owns this approved city.
  const approvedCities = await City.find({ status: "approved" }).select("_id userId cityName").lean();
  const ownerCity = approvedCities.find(city => String(city.cityName).trim().toLocaleLowerCase("en") === cleanTitle.toLocaleLowerCase("en"));
  const row = await Result.create({
    title: cleanTitle, resultText, resultDate,
    published: published === true, sourceUrl: sourceUrl || "", resultSource: "manual",
    ...(ownerCity ? { ownerUserId: ownerCity.userId, cityId: ownerCity._id } : {})
  });
  if (row.published === true) await notifyTelegramPublishedResult(row);
  res.status(201).json(row);
});
app.post("/api/admin/results/:id/telegram", adminOnly, async (req, res) => {
  try {
    const row = await Result.findById(req.params.id);
    if (!row || row.deleted === true) return res.status(404).json({ error: "रिजल्ट नहीं मिला।" });
    if (row.published !== true) return res.status(409).json({ error: "पहले रिजल्ट प्रकाशित करें।" });
    await sendTelegramResultNow(row);
    res.json({ ok: true, message: "Telegram पर रिजल्ट भेज दिया गया।" });
  } catch (error) {
    console.error("Manual Telegram publish failed:", error.message);
    res.status(502).json({ error: error.message || "Telegram पर रिजल्ट नहीं भेजा जा सका।" });
  }
});
app.patch("/api/admin/results/:id", adminOnly, async (req, res) => {
  const allowed = {};
  for (const key of ["title", "resultText", "resultDate", "published", "sourceUrl"])
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, key)) allowed[key] = req.body[key];
  // Any admin edit is an explicit manual override and must be protected from auto-sync.
  allowed.resultSource = "manual";
  const existing = await Result.findById(req.params.id);
  if (!existing) return res.status(404).json({ error: "Record not found" });
  const nextTitle = String(allowed.title ?? existing.title).trim();
  const nextDate = allowed.resultDate !== undefined ? new Date(allowed.resultDate) : existing.resultDate;
  if (Number.isNaN(nextDate.getTime())) return res.status(400).json({ error: "Invalid result date" });
  const dayStart = new Date(Date.UTC(nextDate.getUTCFullYear(), nextDate.getUTCMonth(), nextDate.getUTCDate()));
  const dayEnd = new Date(dayStart.getTime() + 86400000);
  const duplicate = await Result.exists({ _id: { $ne: existing._id }, title: nextTitle, deleted: { $ne: true }, resultDate: { $gte: dayStart, $lt: dayEnd } });
  if (duplicate) return res.status(409).json({ error: "इस शहर/मार्केट का इस तारीख का रिकॉर्ड पहले से मौजूद है।" });
  // Also repair older admin rows when they are edited.
  const approvedCities = await City.find({ status: "approved" }).select("_id userId cityName").lean();
  const ownerCity = approvedCities.find(city => String(city.cityName).trim().toLocaleLowerCase("en") === nextTitle.toLocaleLowerCase("en"));
  if (ownerCity) {
    allowed.ownerUserId = ownerCity.userId;
    allowed.cityId = ownerCity._id;
  }
  const row = await Result.findByIdAndUpdate(req.params.id, allowed, { new: true, runValidators: true });
  if (!row) return res.status(404).json({ error: "Record not found" });
  if (row.published === true && row.deleted !== true) await notifyTelegramPublishedResult(row);
  res.json(row);
});
app.post("/api/admin/results/resolve-conflict", adminOnly, async (req, res) => {
  try {
    const { title, resultDate, manualValue, automaticValue, choice, sourceUrls } = req.body || {};
    if (!title || !resultDate || !manualValue || !automaticValue || !["manual", "automatic"].includes(choice))
      return res.status(400).json({ error: "Conflict चुनने के लिए सभी जानकारी जरूरी है।" });
    const submittedDate = new Date(resultDate);
    if (Number.isNaN(submittedDate.getTime())) return res.status(400).json({ error: "तारीख सही नहीं है।" });
    const dayStart = new Date(Date.UTC(submittedDate.getUTCFullYear(), submittedDate.getUTCMonth(), submittedDate.getUTCDate()));
    const dayEnd = new Date(dayStart.getTime() + 86400000);
    const row = await Result.findOne({
      title: String(title).trim(), deleted: { $ne: true },
      resultDate: { $gte: dayStart, $lt: dayEnd }
    }).sort({ createdAt: -1 });
    if (!row) return res.status(404).json({ error: "इस तारीख का रिकॉर्ड नहीं मिला। Refresh करके दोबारा देखें।" });
    if (String(row.resultText || "").trim() !== String(manualValue).trim() || row.resultSource === "automatic")
      return res.status(409).json({ error: "रिकॉर्ड बदल चुका है। पहले Sync स्थिति Refresh करें।" });
    const urls = Array.isArray(sourceUrls) ? sourceUrls.filter(x => typeof x === "string" && /^https?:\/\//i.test(x)).slice(0, 10) : [];
    row.syncReview = { manualValue: String(manualValue).trim(), automaticValue: String(automaticValue).trim(), choice, reviewedAt: new Date() };
    if (choice === "automatic") {
      row.resultText = String(automaticValue).trim();
      row.resultSource = "automatic";
      row.sourceUrl = urls.join(", ");
      row.ownerUserId = null;
      row.cityId = null;
    } else {
      row.resultSource = "manual";
    }
    await row.save();
    const snapshotUpdated = await syncPublicSnapshot();
    res.json({ ok: true, choice, resultText: row.resultText, snapshotUpdated });
  } catch (err) {
    console.error("Result conflict review failed:", err.message);
    res.status(500).json({ error: "फैसला सेव नहीं हो पाया। दोबारा कोशिश करें।" });
  }
});
app.delete("/api/admin/results/:id", adminOnly, async (req, res) => {
  const row = await Result.findByIdAndUpdate(req.params.id, { deleted: true }, { new: true });
  if (!row) return res.status(404).json({ error: "Record not found" });
  res.json({ ok: true });
});
let snapshotSyncPromise = null;
let snapshotSyncRequested = false;

// Serialize snapshot writes so rapid edits cannot race and overwrite a newer JSON copy.
function syncPublicSnapshot() {
  snapshotSyncRequested = true;
  if (snapshotSyncPromise) return snapshotSyncPromise;
  snapshotSyncPromise = (async () => {
    let synced = false;
    while (snapshotSyncRequested) {
      snapshotSyncRequested = false;
      synced = await syncPublicSnapshotOnce();
    }
    return synced;
  })().finally(() => {
    snapshotSyncPromise = null;
    if (snapshotSyncRequested) {
      syncPublicSnapshot().catch(err => console.error("Queued public snapshot sync failed:", err.message));
    }
  });
  return snapshotSyncPromise;
}

async function syncPublicSnapshotOnce() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.warn("GITHUB_TOKEN is not configured; public static snapshot was not updated.");
    return false;
  }
  const repo = process.env.GITHUB_REPO || "jasmelsolanki2017-svg/rk-bhai-results-portal-";
  // Snapshot must use the same approved-city visibility rule as the live public API.
  const approvedCities = await City.find({ status: "approved" })
    .select("cityName expectedTime").sort({ cityName: 1 }).lean();
  const approvedCityIds = approvedCities.map(c => c._id);
  const filter = {
    published: true,
    deleted: { $ne: true },
    $or: [{ ownerUserId: null }, { ownerUserId: { $exists: false } }, { cityId: { $in: approvedCityIds } }]
  };
  const results = await Result.find(filter)
    .select("title resultText resultDate sourceUrl createdAt")
    .sort({ resultDate: -1, title: 1 }).limit(20000).lean();
  const cityMap = new Map();
  for (const c of approvedCities) cityMap.set(String(c.cityName).trim().toLocaleLowerCase("en"), { cityName: c.cityName, expectedTime: c.expectedTime || "" });
  for (const r of results) {
    const key = String(r.title || "").trim().toLocaleLowerCase("en");
    if (key && !cityMap.has(key)) cityMap.set(key, { cityName: String(r.title).trim(), expectedTime: "" });
  }
  const cities = [...cityMap.values()].sort((a,b) => a.cityName.localeCompare(b.cityName));
  const snapshot = {
    app: "rk-bhai-results-portal",
    updatedAt: new Date().toISOString(),
    results: results.map(r => ({
      _id: String(r._id),
      title: r.title,
      resultText: r.resultText,
      resultDate: r.resultDate,
      sourceUrl: r.sourceUrl || "",
      createdAt: r.createdAt || null
    })),
    cities
  };
  // Keep public data on its own branch so snapshot updates do not redeploy this Render service.
  const snapshotBranch = "public-data";
  const apiUrl = "https://api.github.com/repos/" + repo + "/contents/data/public-results.json";
  const headers = {
    "Authorization": "Bearer " + token,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  const currentResponse = await fetch(apiUrl + "?ref=" + snapshotBranch, { headers });
  let sha;
  if (currentResponse.ok) {
    const current = await currentResponse.json();
    sha = current.sha;
    try {
      const currentText = Buffer.from(String(current.content || "").replace(/\n/g, ""), "base64").toString("utf8");
      const currentSnapshot = JSON.parse(currentText);
      const samePublicData =
        JSON.stringify({ app: currentSnapshot.app, results: currentSnapshot.results, cities: currentSnapshot.cities }) ===
        JSON.stringify({ app: snapshot.app, results: snapshot.results, cities: snapshot.cities });
      if (samePublicData) {
        console.log("Public results snapshot unchanged; GitHub commit skipped:", results.length, "results");
        return true;
      }
    } catch (compareError) {
      console.warn("Could not compare existing public snapshot; replacing it:", compareError.message);
    }
  } else if (currentResponse.status !== 404) {
    throw new Error("GitHub file lookup returned " + currentResponse.status);
  }
  const payload = {
    message: "Update public results snapshot",
    content: Buffer.from(JSON.stringify(snapshot, null, 2) + "\n", "utf8").toString("base64"),
    branch: snapshotBranch
  };
  if (sha) payload.sha = sha;
  const writeResponse = await fetch(apiUrl, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!writeResponse.ok) {
    const detail = await writeResponse.text();
    throw new Error("GitHub snapshot update returned " + writeResponse.status + ": " + detail.slice(0, 300));
  }
  console.log("Public results snapshot updated on GitHub:", results.length, "results");
  return true;
}

app.post("/api/admin/sync-public-snapshot", adminOnly, async (req, res) => {
  try {
    const synced = await syncPublicSnapshot();
    if (!synced) return res.status(503).json({ error: "Render में GITHUB_TOKEN सेट करना बाकी है।" });
    res.json({ ok: true, message: "Public results snapshot updated." });
  } catch (err) {
    console.error("Manual public snapshot sync failed:", err.message);
    res.status(502).json({ error: "GitHub पर public snapshot अपडेट नहीं हो पाया।" });
  }
});
app.get("/api/health", (req, res) => res.json({ ok: true }));


async function cleanupChandigarhDuplicates() {
  const rows = await Result.find({ title: /chandigarh/i, deleted: { $ne: true } }).sort({ createdAt: 1, _id: 1 });
  const keepByDate = new Map();
  let removed = 0;
  for (const row of rows) {
    const day = row.resultDate.toISOString().slice(0, 10);
    if (keepByDate.has(day)) {
      row.deleted = true;
      await row.save();
      removed++;
    } else {
      keepByDate.set(day, row);
      if (row.title !== "Chandigarh City") { row.title = "Chandigarh City"; await row.save(); }
    }
  }
  console.log("Chandigarh duplicate records hidden:", removed);
}

async function importHistoricalArchive() {
  console.log("Starting verified 2024-2025 historical archive import");
  const importKey = "verified-yearly-archive-2024-2025-v1";
  if (await HistoricalImport.findOne({ key: importKey }).lean()) {
    console.log("Historical 2024-2025 archive import already completed");
    return;
  }

  const sources = [
    { title: "Disawar", year: 2024, expected: 352, url: "https://satta-klng.com/satta-king-result-of-disawar-2024" },
    { title: "Disawar", year: 2025, expected: 349, url: "https://satta-klng.com/satta-king-result-of-disawar-2025" },
    { title: "Faridabad", year: 2024, expected: 354, url: "https://satta-klng.com/satta-king-result-of-faridabad-2024" },
    { title: "Faridabad", year: 2025, expected: 351, url: "https://satta-klng.com/satta-king-result-of-faridabad-2025" },
    { title: "Ghaziabad", year: 2024, expected: 354, url: "https://satta-klng.com/satta-king-result-of-ghaziabad-2024" },
    { title: "Ghaziabad", year: 2025, expected: 353, url: "https://satta-klng.com/satta-king-result-of-ghaziabad-2025" },
    { title: "Gali", year: 2024, expected: 354, url: "https://satta-klng.com/satta-king-result-of-gali-2024" },
    { title: "Gali", year: 2025, expected: 346, url: "https://satta-klng.com/satta-king-result-of-gali-2025" },
    { title: "Shree Ganesh", year: 2024, expected: 353, url: "https://satta-klng.com/satta-king-result-of-shree-ganesh-2024" },
    { title: "Shree Ganesh", year: 2025, expected: 353, url: "https://satta-klng.com/satta-king-result-of-shree-ganesh-2025" }
  ];

  function cleanCell(html) {
    return html
      .replace(/<script\b[\s\S]*?<\/script>/gi, "")
      .replace(/<style\b[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;|&#160;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
      .replace(/\s+/g, " ")
      .trim();
  }

  function parseChart(html, source) {
    const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
    const monthRows = new Map();
    for (const match of rows) {
      const cells = [...match[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => cleanCell(cell[1]));
      if (cells.length < 13 || !/^\d{1,2}$/.test(cells[0] || "")) continue;
      const day = Number(cells[0]);
      if (day < 1 || day > 31) continue;
      monthRows.set(day, cells.slice(1, 13));
    }
    if (monthRows.size < 28) throw new Error("Could not parse complete date rows for " + source.title + " " + source.year);

    const records = [];
    let declared = 0;
    for (let month = 0; month < 12; month++) {
      const daysInMonth = new Date(Date.UTC(source.year, month + 1, 0)).getUTCDate();
      for (let day = 1; day <= daysInMonth; day++) {
        const values = monthRows.get(day);
        if (!values) throw new Error("Missing date row " + day + " for " + source.title + " " + source.year);
        const raw = (values[month] || "").trim();
        const resultText = /^\d{2}$/.test(raw) ? raw : "XX";
        if (resultText !== "XX") declared++;
        records.push({
          title: source.title,
          resultText,
          resultDate: new Date(Date.UTC(source.year, month, day, 12, 0, 0)),
          published: true,
          sourceUrl: source.url
        });
      }
    }
    if (declared !== source.expected) {
      throw new Error("Declared-result validation failed for " + source.title + " " + source.year + ": expected " + source.expected + ", parsed " + declared);
    }
    return { records, declared };
  }

  const parsed = await Promise.all(sources.map(async source => {
    console.log("Fetching historical chart:", source.title, source.year);
    const response = await fetch(source.url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; RKBhaiArchive/1.0)" }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error("Source fetch failed for " + source.title + " " + source.year + ": HTTP " + response.status);
    const html = await response.text();
    console.log("Historical chart downloaded:", source.title, source.year, html.length);
    const parsedChart = parseChart(html, source);
    console.log("Historical chart validated:", source.title, source.year, parsedChart.declared);
    return parsedChart;
  }));

  const operations = [];
  let declaredCount = 0;
  for (const item of parsed) {
    declaredCount += item.declared;
    for (const record of item.records) {
      const start = new Date(Date.UTC(record.resultDate.getUTCFullYear(), record.resultDate.getUTCMonth(), record.resultDate.getUTCDate()));
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
      operations.push({
        updateOne: {
          filter: { title: record.title, resultDate: { $gte: start, $lt: end } },
          update: { $setOnInsert: record },
          upsert: true
        }
      });
    }
  }

  // No verified yearly archive exists for these two labels in the source archive.
  for (const title of ["Delhi Bazar", "Chandigarh City"]) {
    for (const year of [2024, 2025]) {
      for (let month = 0; month < 12; month++) {
        const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
        for (let day = 1; day <= daysInMonth; day++) {
          const start = new Date(Date.UTC(year, month, day));
          const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
          operations.push({
            updateOne: {
              filter: { title, resultDate: { $gte: start, $lt: end } },
              update: { $setOnInsert: { title, resultText: "XX", resultDate: new Date(Date.UTC(year, month, day, 12)), published: true, sourceUrl: "" } },
              upsert: true
            }
          });
        }
      }
    }
  }

  console.log("Writing verified historical records to MongoDB:", operations.length);
  const result = await Result.bulkWrite(operations, { ordered: false });
  await HistoricalImport.create({
    key: importKey,
    recordCount: operations.length,
    declaredCount
  });
  console.log("Historical 2024-2025 import complete:", JSON.stringify({
    attempted: operations.length,
    inserted: result.upsertedCount || 0,
    declaredActualsVerified: declaredCount,
    placeholders: operations.length - declaredCount
  }));
}

async function importEarly2026Archive() {
  const importKey = "verified-monthly-archive-2026-jan-may-v1";
  if (await HistoricalImport.findOne({ key: importKey }).lean()) {
    console.log("Historical January-May 2026 import already completed");
    return;
  }

  const months = [
    { month: 1, expected: 181, url: "https://satta-klng.com/satta-king-result-of-january-2026" },
    { month: 2, expected: 162, url: "https://satta-klng.com/satta-king-result-of-february-2026" },
    { month: 3, expected: 180, url: "https://satta-klng.com/satta-king-result-of-march-2026" },
    { month: 4, expected: 174, url: "https://satta-klng.com/satta-king-result-of-april-2026" },
    { month: 5, expected: 180, url: "https://satta-klng.com/satta-king-result-of-may-2026" }
  ];
  const titles = ["Disawar", "Delhi Bazar", "Shree Ganesh", "Faridabad", "Ghaziabad", "Gali"];

  function cleanMonthlyCell(html) {
    return html.replace(/<script\b[\s\S]*?<\/script>/gi, "")
      .replace(/<style\b[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;|&#160;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/\s+/g, " ").trim();
  }

  const parsed = await Promise.all(months.map(async item => {
    console.log("Fetching 2026 monthly archive:", item.month);
    const response = await fetch(item.url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; RKBhaiArchive/1.0)" },
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error("2026 monthly source failed for month " + item.month + ": HTTP " + response.status);
    const html = await response.text();
    const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
    const dayRows = new Map();
    for (const match of rows) {
      const cells = [...match[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => cleanMonthlyCell(cell[1]));
      if (cells.length < 7 || !/^\d{2}-\d{2}-2026$/.test(cells[0] || "")) continue;
      const [day, month, year] = cells[0].split("-").map(Number);
      if (month !== item.month || year !== 2026) continue;
      dayRows.set(day, cells.slice(1, 7));
    }
    const daysInMonth = new Date(Date.UTC(2026, item.month, 0)).getUTCDate();
    if (dayRows.size !== daysInMonth) throw new Error("2026 monthly date validation failed for month " + item.month + ": parsed " + dayRows.size + " of " + daysInMonth);

    const records = [];
    let declared = 0;
    for (let day = 1; day <= daysInMonth; day++) {
      const values = dayRows.get(day);
      for (let i = 0; i < titles.length; i++) {
        const raw = (values[i] || "").trim();
        const resultText = /^\d{2}$/.test(raw) ? raw : "XX";
        if (resultText !== "XX") declared++;
        records.push({
          title: titles[i],
          resultText,
          resultDate: new Date(Date.UTC(2026, item.month - 1, day, 12)),
          published: true,
          sourceUrl: item.url
        });
      }
    }
    if (declared !== item.expected) throw new Error("2026 monthly declared-count validation failed for month " + item.month + ": expected " + item.expected + ", parsed " + declared);
    console.log("2026 monthly chart validated:", item.month, declared);
    return records;
  }));

  const operations = [];
  for (const record of parsed.flat()) {
    const start = new Date(Date.UTC(record.resultDate.getUTCFullYear(), record.resultDate.getUTCMonth(), record.resultDate.getUTCDate()));
    operations.push({
      updateOne: {
        filter: { title: record.title, resultDate: { $gte: start, $lt: new Date(start.getTime() + 86400000) } },
        update: { $setOnInsert: record },
        upsert: true
      }
    });
  }

  // Chandigarh City has no verified source chart for this period.
  for (let month = 0; month < 5; month++) {
    const daysInMonth = new Date(Date.UTC(2026, month + 1, 0)).getUTCDate();
    for (let day = 1; day <= daysInMonth; day++) {
      const start = new Date(Date.UTC(2026, month, day));
      operations.push({
        updateOne: {
          filter: { title: "Chandigarh City", resultDate: { $gte: start, $lt: new Date(start.getTime() + 86400000) } },
          update: { $setOnInsert: { title: "Chandigarh City", resultText: "XX", resultDate: new Date(Date.UTC(2026, month, day, 12)), published: true, sourceUrl: "" } },
          upsert: true
        }
      });
    }
  }

  console.log("Writing early-2026 historical records:", operations.length);
  const result = await Result.bulkWrite(operations, { ordered: false });
  await HistoricalImport.create({ key: importKey, recordCount: operations.length, declaredCount: 877 });
  console.log("Historical January-May 2026 import complete:", JSON.stringify({
    attempted: operations.length,
    inserted: result.upsertedCount || 0,
    declaredActualsVerified: 877,
    placeholders: operations.length - 877
  }));
}

async function seedHistoricalRecords() {
  const recordsPath = path.join(__dirname, "data", "historical-records.json");
  const records = JSON.parse(require("fs").readFileSync(recordsPath, "utf8"));
  for (const item of records) {
    const start = new Date(item.date + "T00:00:00.000Z");
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    await Result.findOneAndUpdate(
      { title: item.title, resultDate: { $gte: start, $lt: end } },
      { $setOnInsert: { resultText: item.resultText, resultDate: new Date(item.date + "T12:00:00.000Z"), published: true, sourceUrl: item.sourceUrl } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }
  console.log(`Historical archive records checked: ${records.length}`);
}

async function disableExpiredUsers() {
  const result = await User.updateMany({ active: true, expiresAt: { $ne: null, $lte: new Date() } }, { $set: { active: false } });
  if (result.modifiedCount) console.log("Expired user accounts disabled:", result.modifiedCount);
}

const port = process.env.PORT || 3000;

// Start HTTP immediately so public pages remain reachable during a database outage.
app.listen(port, () => console.log(`RK portal running on ${port}`));

let databaseStartupTasksDone = false;
async function connectDatabaseWithRetry() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    console.log("MongoDB connected");
    if (!databaseStartupTasksDone) {
      try {
        // Remove the legacy one-city-per-user unique index so one account can own multiple cities.
        try {
          const indexes = await City.collection.indexes();
          const legacyUniqueUserIndex = indexes.find(index => index.unique && index.key && index.key.userId === 1);
          if (legacyUniqueUserIndex) {
            await City.collection.dropIndex(legacyUniqueUserIndex.name);
            console.log("Removed legacy unique city-owner index:", legacyUniqueUserIndex.name);
          }
        } catch (indexError) {
          if (indexError.code !== 27 && indexError.codeName !== "IndexNotFound") throw indexError;
        }
        await importHistoricalArchive();
        await importEarly2026Archive();
        await seedHistoricalRecords();
        await cleanupChandigarhDuplicates();
        await disableExpiredUsers();
        if (process.env.GITHUB_TOKEN) {
          try { await syncPublicSnapshot(); }
          catch (snapshotError) { console.error("Initial public snapshot sync failed:", snapshotError.message); }
        }
        setInterval(() => disableExpiredUsers().catch(err => console.error("Expiry check failed:", err.message)), 60 * 1000);
        databaseStartupTasksDone = true;
      } catch (startupTaskError) {
        console.error("Database startup task failed:", startupTaskError.message);
      }
    }
  } catch (err) {
    console.error("Database connection failed; HTTP server remains available. Retrying in 15 seconds:", err.message);
    const retry = setTimeout(connectDatabaseWithRetry, 15000);
    if (retry.unref) retry.unref();
  }
}
connectDatabaseWithRetry();
