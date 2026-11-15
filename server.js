require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "30kb" }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
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

const City = mongoose.model("PortalCity", new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "PortalUser", required: true, unique: true },
  cityName: { type: String, required: true, trim: true, maxlength: 60 },
  expectedTime: { type: String, default: "" },
  status: { type: String, enum: ["pending", "approved", "rejected", "returned", "hidden"], default: "pending" },
  createdAt: { type: Date, default: Date.now },
  reviewedAt: { type: Date, default: null }
}));

const Result = mongoose.model("Result", new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 100 },
  resultText: { type: String, required: true, trim: true, maxlength: 300 },
  resultDate: { type: Date, required: true },
  published: { type: Boolean, default: false },
  deleted: { type: Boolean, default: false },
  sourceUrl: { type: String, default: "" },
  ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: "PortalUser", default: null, index: true },
  cityId: { type: mongoose.Schema.Types.ObjectId, ref: "PortalCity", default: null, index: true },
  createdAt: { type: Date, default: Date.now }
}));

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

function adminOnly(req, res, next) {
  try {
    const token = req.cookies.admin_session;
    if (!token) return res.status(401).json({ error: "Login required" });
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    next();
  } catch {
    return res.status(401).json({ error: "Session expired. Login again." });
  }
}

app.post("/api/admin/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password || !process.env.ADMIN_USERNAME || !adminPasswordHash || !process.env.JWT_SECRET)
    return res.status(400).json({ error: "Admin configuration missing" });
  const validUser = username === process.env.ADMIN_USERNAME;
  const validPass = await bcrypt.compare(password, adminPasswordHash);
  if (!validUser || !validPass) return res.status(401).json({ error: "Incorrect login" });
  const token = jwt.sign({ role: "admin" }, process.env.JWT_SECRET, { expiresIn: "8h" });
  res.cookie("admin_session", token, {
    httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production",
    maxAge: 8 * 60 * 60 * 1000, path: "/"
  });
  res.json({ ok: true });
});

app.get("/api/admin/session", adminOnly, (req, res) => res.json({ ok: true, role: "admin" }));

app.get("/api/admin/users", adminOnly, async (req, res) => {
  await disableExpiredUsers();
  const users = await User.find().select("name username mobile email active expiresAt createdAt").sort({ createdAt: -1 }).lean();
  const cities = await City.find().lean();
  const cityByUser = new Map(cities.map(c => [String(c.userId), c]));
  res.json(users.map(u => { const c = cityByUser.get(String(u._id)); return { ...u, city: c ? { id: c._id, name: c.cityName, status: c.status } : null }; }));
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
  const city = await City.findOneAndDelete({ userId: user._id });
  if (city) await Result.updateMany({ cityId: city._id }, { $set: { deleted: true, published: false } });
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
  const city = await City.create({ userId: req.portalUserId, cityName, expectedTime, status: "pending" });
  res.status(201).json({ id: city._id, cityName: city.cityName, expectedTime: city.expectedTime, status: city.status });
});
app.patch("/api/user/city/name", userOnly, async (req, res) => {
  const cityName = String(req.body?.cityName || "").trim().replace(/\\s+/g, " ");
  const expectedTime = String(req.body?.expectedTime || "");
  if (cityName.length < 2 || cityName.length > 60) return res.status(400).json({ error: "शहर का नाम 2 से 60 अक्षर का रखें।" });
  if (!/^([01]\\d|2[0-3]):[0-5]\\d$/.test(expectedTime)) return res.status(400).json({ error: "परिणाम आने का सही समय चुनें।" });
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
  const rows = await Result.find({ ownerUserId: req.portalUserId, deleted: { $ne: true } }).sort({ resultDate: -1 }).limit(500).lean();
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


app.post("/api/admin/logout", adminOnly, (req, res) => {
  res.clearCookie("admin_session", { path: "/", sameSite: "strict", secure: process.env.NODE_ENV === "production" });
  res.json({ ok: true });
});

app.get("/api/public/cities", async (req, res) => {
  const activeUsers = await User.find({ active: true, $or: [{ expiresAt: null }, { expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }] }).distinct("_id");
  const cities = await City.find({ status: "approved", userId: { $in: activeUsers } }).select("cityName expectedTime").sort({ cityName: 1 }).lean();
  res.json(cities.map(c => ({ cityName: c.cityName, expectedTime: c.expectedTime || "" })));
});
app.get("/api/results", async (req, res) => {
  const activeUsers = await User.find({ active: true, $or: [{ expiresAt: null }, { expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }] }).distinct("_id");
  const approvedCityIds = await City.find({ status: "approved", userId: { $in: activeUsers } }).distinct("_id");
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
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(req.query.date))
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
app.patch("/api/admin/cities/:id", adminOnly, async (req, res) => {
  const update = {};
  if (req.body?.status !== undefined) {
    if (!["approved", "rejected", "returned", "hidden", "pending"].includes(req.body.status)) return res.status(400).json({ error: "Invalid city status" });
    update.status = req.body.status;
    update.reviewedAt = new Date();
  }
  if (req.body?.cityName !== undefined) {
    const cityName = String(req.body.cityName).trim().replace(/\\s+/g, " ");
    if (cityName.length < 2 || cityName.length > 60) return res.status(400).json({ error: "शहर का नाम 2 से 60 अक्षर का रखें।" });
    update.cityName = cityName;
  }
  const city = await City.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
  if (!city) return res.status(404).json({ error: "City request नहीं मिली।" });
  if (req.body?.status && req.body.status !== "approved") await Result.updateMany({ cityId: city._id }, { $set: { published: false } });
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
  const filter = { deleted: { $ne: true } };
  if (req.query.month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(req.query.month))
      return res.status(400).json({ error: "Invalid month. Use YYYY-MM." });
    const [year, month] = req.query.month.split("-").map(Number);
    filter.resultDate = { $gte: new Date(Date.UTC(year, month - 1, 1)), $lt: new Date(Date.UTC(year, month, 1)) };
  }
  res.json(await Result.find(filter).sort({ resultDate: -1, title: 1 }).limit(2000).lean());
});
app.post("/api/admin/results", adminOnly, async (req, res) => {
  const { title, resultText, resultDate, published, sourceUrl } = req.body || {};
  if (!title || !resultText || !resultDate || Number.isNaN(Date.parse(resultDate)))
    return res.status(400).json({ error: "Title, result and valid date are required" });
  const submittedDate = new Date(resultDate);
  const dayStart = new Date(Date.UTC(submittedDate.getUTCFullYear(), submittedDate.getUTCMonth(), submittedDate.getUTCDate()));
  const dayEnd = new Date(dayStart.getTime() + 86400000);
  const duplicate = await Result.exists({ title: String(title).trim(), deleted: { $ne: true }, resultDate: { $gte: dayStart, $lt: dayEnd } });
  if (duplicate) return res.status(409).json({ error: "इस शहर/मार्केट का इस तारीख का रिकॉर्ड पहले से मौजूद है। पुराने रिकॉर्ड को edit करें।" });
  const row = await Result.create({ title, resultText, resultDate, published: published === true, sourceUrl: sourceUrl || "" });
  res.status(201).json(row);
});
app.patch("/api/admin/results/:id", adminOnly, async (req, res) => {
  const allowed = {};
  for (const key of ["title", "resultText", "resultDate", "published", "sourceUrl"])
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, key)) allowed[key] = req.body[key];
  const existing = await Result.findById(req.params.id);
  if (!existing) return res.status(404).json({ error: "Record not found" });
  const nextTitle = String(allowed.title ?? existing.title).trim();
  const nextDate = allowed.resultDate !== undefined ? new Date(allowed.resultDate) : existing.resultDate;
  if (Number.isNaN(nextDate.getTime())) return res.status(400).json({ error: "Invalid result date" });
  const dayStart = new Date(Date.UTC(nextDate.getUTCFullYear(), nextDate.getUTCMonth(), nextDate.getUTCDate()));
  const dayEnd = new Date(dayStart.getTime() + 86400000);
  const duplicate = await Result.exists({ _id: { $ne: existing._id }, title: nextTitle, deleted: { $ne: true }, resultDate: { $gte: dayStart, $lt: dayEnd } });
  if (duplicate) return res.status(409).json({ error: "इस शहर/मार्केट का इस तारीख का रिकॉर्ड पहले से मौजूद है।" });
  const row = await Result.findByIdAndUpdate(req.params.id, allowed, { new: true, runValidators: true });
  if (!row) return res.status(404).json({ error: "Record not found" });
  res.json(row);
});
app.delete("/api/admin/results/:id", adminOnly, async (req, res) => {
  const row = await Result.findByIdAndUpdate(req.params.id, { deleted: true }, { new: true });
  if (!row) return res.status(404).json({ error: "Record not found" });
  res.json({ ok: true });
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
mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    await seedHistoricalRecords();
    await cleanupChandigarhDuplicates();
    await disableExpiredUsers();
    setInterval(() => disableExpiredUsers().catch(err => console.error("Expiry check failed:", err.message)), 60 * 1000);
    app.listen(port, () => console.log(`RK portal running on ${port}`));
  })
  .catch(err => { console.error("Database connection failed:", err.message); process.exit(1); });
