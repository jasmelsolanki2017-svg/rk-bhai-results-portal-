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

const Result = mongoose.model("Result", new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 100 },
  resultText: { type: String, required: true, trim: true, maxlength: 300 },
  resultDate: { type: Date, required: true },
  published: { type: Boolean, default: false },
  sourceUrl: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now }
}));

// Prefer a pre-generated bcrypt hash. ADMIN_PASSWORD is supported for simple
// Render setup and is converted to a bcrypt hash once when the process starts.
const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH ||
  (process.env.ADMIN_PASSWORD ? bcrypt.hashSync(process.env.ADMIN_PASSWORD, 12) : "");

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
    maxAge: 8 * 60 * 60 * 1000
  });
  res.json({ ok: true });
});

app.post("/api/admin/logout", adminOnly, (req, res) => {
  res.clearCookie("admin_session");
  res.json({ ok: true });
});

app.get("/api/results", async (req, res) => {
  const filter = { published: true };
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
app.get("/api/admin/results", adminOnly, async (req, res) => {
  res.json(await Result.find().sort({ resultDate: -1 }).limit(200).lean());
});
app.post("/api/admin/results", adminOnly, async (req, res) => {
  const { title, resultText, resultDate, published } = req.body || {};
  if (!title || !resultText || !resultDate || Number.isNaN(Date.parse(resultDate)))
    return res.status(400).json({ error: "Title, result and valid date are required" });
  const row = await Result.create({ title, resultText, resultDate, published: published === true });
  res.status(201).json(row);
});
app.patch("/api/admin/results/:id", adminOnly, async (req, res) => {
  const allowed = {};
  for (const key of ["title", "resultText", "resultDate", "published"])
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, key)) allowed[key] = req.body[key];
  const row = await Result.findByIdAndUpdate(req.params.id, allowed, { new: true, runValidators: true });
  if (!row) return res.status(404).json({ error: "Record not found" });
  res.json(row);
});
app.delete("/api/admin/results/:id", adminOnly, async (req, res) => {
  const row = await Result.findByIdAndDelete(req.params.id);
  if (!row) return res.status(404).json({ error: "Record not found" });
  res.json({ ok: true });
});
app.get("/api/health", (req, res) => res.json({ ok: true }));

async function seedHistoricalRecords() {
  const recordsPath = path.join(__dirname, "data", "historical-records.json");
  const records = JSON.parse(require("fs").readFileSync(recordsPath, "utf8"));
  for (const item of records) {
    const start = new Date(item.date + "T00:00:00.000Z");
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    await Result.findOneAndUpdate(
      { title: item.title, resultDate: { $gte: start, $lt: end } },
      { $set: { resultText: item.resultText, resultDate: new Date(item.date + "T12:00:00.000Z"), published: true, sourceUrl: item.sourceUrl } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }
  console.log(`Historical archive records checked: ${records.length}`);
}

const port = process.env.PORT || 3000;
mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    await seedHistoricalRecords();
    app.listen(port, () => console.log(`RK portal running on ${port}`));
  })
  .catch(err => { console.error("Database connection failed:", err.message); process.exit(1); });
