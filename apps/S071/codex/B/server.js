require("dotenv").config();

const bcrypt = require("bcrypt");
const crypto = require("crypto");
const csurf = require("csurf");
const express = require("express");
const helmet = require("helmet");
const https = require("https");
const path = require("path");
const rateLimit = require("express-rate-limit");
const selfsigned = require("selfsigned");
const session = require("express-session");
const SQLiteStoreFactory = require("connect-sqlite3");
const sqlite3 = require("sqlite3").verbose();
const { body, param, validationResult } = require("express-validator");

const app = express();
const PORT = Number(process.env.PORT || 5071);
const SESSION_SECRET = process.env.SESSION_SECRET;
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, "auction.sqlite");
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 12);

if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  console.error("SESSION_SECRET must be set to at least 32 characters.");
  process.exit(1);
}

const db = new sqlite3.Database(DB_PATH);
const SQLiteStore = SQLiteStoreFactory(session);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

async function initDb() {
  await run("PRAGMA foreign_keys = ON");
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS auctions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seller_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      starting_price_cents INTEGER NOT NULL CHECK (starting_price_cents > 0),
      end_time TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS bids (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      auction_id INTEGER NOT NULL,
      bidder_id INTEGER NOT NULL,
      amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (auction_id) REFERENCES auctions(id) ON DELETE CASCADE,
      FOREIGN KEY (bidder_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  await run("CREATE INDEX IF NOT EXISTS idx_bids_auction_amount ON bids(auction_id, amount_cents DESC, created_at ASC)");
}

app.disable("x-powered-by");
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.set("trust proxy", 1);

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "script-src": ["'self'"],
      "style-src": ["'self'"],
      "img-src": ["'self'", "data:"],
      "form-action": ["'self'"],
      "base-uri": ["'self'"],
      "frame-ancestors": ["'none'"]
    }
  }
}));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public"), { index: false, maxAge: "1h" }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false }));
app.use(session({
  store: new SQLiteStore({ db: "sessions.sqlite", dir: __dirname }),
  name: "auction.sid",
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 4
  }
}));
app.use(csurf());

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.csrfToken = req.csrfToken();
  res.locals.errors = [];
  res.locals.form = {};
  res.locals.money = cents => `$${(Number(cents) / 100).toFixed(2)}`;
  res.locals.isEnded = endTime => new Date(endTime).getTime() <= Date.now();
  next();
});

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

function collectErrors(req, res, next) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();
  req.formErrors = errors.array().map(err => err.msg);
  next();
}

function dollarsToCents(value) {
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(String(value))) return NaN;
  const [whole, fraction = ""] = String(value).split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

async function auctionWithBid(id) {
  return get(`
    SELECT a.*, u.username AS seller_name,
      COALESCE(MAX(b.amount_cents), a.starting_price_cents) AS current_price_cents,
      hb.bidder_id AS highest_bidder_id,
      hu.username AS highest_bidder_name
    FROM auctions a
    JOIN users u ON u.id = a.seller_id
    LEFT JOIN bids b ON b.auction_id = a.id
    LEFT JOIN bids hb ON hb.id = (
      SELECT id FROM bids WHERE auction_id = a.id ORDER BY amount_cents DESC, created_at ASC LIMIT 1
    )
    LEFT JOIN users hu ON hu.id = hb.bidder_id
    WHERE a.id = ?
    GROUP BY a.id
  `, [id]);
}

app.get("/", async (req, res, next) => {
  try {
    const auctions = await all(`
      SELECT a.id, a.title, a.end_time, a.starting_price_cents, u.username AS seller_name,
        COALESCE(MAX(b.amount_cents), a.starting_price_cents) AS current_price_cents
      FROM auctions a
      JOIN users u ON u.id = a.seller_id
      LEFT JOIN bids b ON b.auction_id = a.id
      GROUP BY a.id
      ORDER BY datetime(a.end_time) ASC
    `);
    res.render("index", { auctions });
  } catch (err) {
    next(err);
  }
});

app.get("/register", (req, res) => res.render("register"));

app.post("/register",
  body("username").trim().isLength({ min: 3, max: 32 }).withMessage("Username must be 3-32 characters.").matches(/^[a-zA-Z0-9_]+$/).withMessage("Username may contain letters, numbers, and underscores."),
  body("password").isLength({ min: 12, max: 128 }).withMessage("Password must be 12-128 characters."),
  collectErrors,
  async (req, res, next) => {
    if (req.formErrors) return res.status(400).render("register", { errors: req.formErrors, form: { username: req.body.username } });
    try {
      const passwordHash = await bcrypt.hash(req.body.password, BCRYPT_ROUNDS);
      const result = await run("INSERT INTO users (username, password_hash) VALUES (?, ?)", [req.body.username, passwordHash]);
      req.session.regenerate(err => {
        if (err) return next(err);
        req.session.user = { id: result.lastID, username: req.body.username };
        res.redirect("/");
      });
    } catch (err) {
      if (err.message.includes("UNIQUE")) return res.status(409).render("register", { errors: ["That username is already taken."], form: { username: req.body.username } });
      next(err);
    }
  }
);

app.get("/login", (req, res) => res.render("login"));

app.post("/login",
  rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false }),
  body("username").trim().isLength({ min: 3, max: 32 }).withMessage("Invalid username or password."),
  body("password").isLength({ min: 1, max: 128 }).withMessage("Invalid username or password."),
  collectErrors,
  async (req, res, next) => {
    if (req.formErrors) return res.status(400).render("login", { errors: ["Invalid username or password."], form: { username: req.body.username } });
    try {
      const user = await get("SELECT id, username, password_hash FROM users WHERE username = ?", [req.body.username]);
      const ok = user && await bcrypt.compare(req.body.password, user.password_hash);
      if (!ok) return res.status(401).render("login", { errors: ["Invalid username or password."], form: { username: req.body.username } });
      req.session.regenerate(err => {
        if (err) return next(err);
        req.session.user = { id: user.id, username: user.username };
        res.redirect("/");
      });
    } catch (err) {
      next(err);
    }
  }
);

app.post("/logout", requireAuth, (req, res, next) => {
  req.session.destroy(err => {
    if (err) return next(err);
    res.clearCookie("auction.sid");
    res.redirect("/");
  });
});

app.get("/auctions/new", requireAuth, (req, res) => res.render("new-auction"));

app.post("/auctions",
  requireAuth,
  body("title").trim().isLength({ min: 3, max: 100 }).withMessage("Title must be 3-100 characters."),
  body("description").trim().isLength({ min: 1, max: 1000 }).withMessage("Description is required and must be under 1000 characters."),
  body("startingPrice").custom(value => Number.isInteger(dollarsToCents(value)) && dollarsToCents(value) > 0).withMessage("Starting price must be a positive dollar amount."),
  body("endTime").isISO8601().withMessage("End time must be a valid date.").custom(value => new Date(value).getTime() > Date.now() + 60_000).withMessage("End time must be at least one minute in the future."),
  collectErrors,
  async (req, res, next) => {
    const form = { title: req.body.title, description: req.body.description, startingPrice: req.body.startingPrice, endTime: req.body.endTime };
    if (req.formErrors) return res.status(400).render("new-auction", { errors: req.formErrors, form });
    try {
      await run(
        "INSERT INTO auctions (seller_id, title, description, starting_price_cents, end_time) VALUES (?, ?, ?, ?, ?)",
        [req.session.user.id, req.body.title, req.body.description, dollarsToCents(req.body.startingPrice), new Date(req.body.endTime).toISOString()]
      );
      res.redirect("/");
    } catch (err) {
      next(err);
    }
  }
);

app.get("/auctions/:id",
  param("id").isInt({ min: 1 }).toInt(),
  collectErrors,
  async (req, res, next) => {
    if (req.formErrors) return res.status(404).render("not-found");
    try {
      const auction = await auctionWithBid(req.params.id);
      if (!auction) return res.status(404).render("not-found");
      const bids = await all(`
        SELECT b.amount_cents, b.created_at, u.username
        FROM bids b
        JOIN users u ON u.id = b.bidder_id
        WHERE b.auction_id = ?
        ORDER BY b.amount_cents DESC, datetime(b.created_at) ASC
      `, [req.params.id]);
      res.render("auction", { auction, bids });
    } catch (err) {
      next(err);
    }
  }
);

app.post("/auctions/:id/bids",
  requireAuth,
  param("id").isInt({ min: 1 }).toInt(),
  body("amount").custom(value => Number.isInteger(dollarsToCents(value)) && dollarsToCents(value) > 0).withMessage("Bid must be a positive dollar amount."),
  collectErrors,
  async (req, res, next) => {
    try {
      const auction = await auctionWithBid(req.params.id);
      if (!auction) return res.status(404).render("not-found");
      const errors = req.formErrors || [];
      if (auction.seller_id === req.session.user.id) errors.push("Sellers cannot bid on their own auctions.");
      if (new Date(auction.end_time).getTime() <= Date.now()) errors.push("This auction has ended.");
      const amount = dollarsToCents(req.body.amount);
      if (Number.isInteger(amount) && amount <= auction.current_price_cents) errors.push("Bid must exceed the current highest bid.");
      if (errors.length) {
        const bids = await all(`
          SELECT b.amount_cents, b.created_at, u.username
          FROM bids b JOIN users u ON u.id = b.bidder_id
          WHERE b.auction_id = ?
          ORDER BY b.amount_cents DESC, datetime(b.created_at) ASC
        `, [req.params.id]);
        return res.status(400).render("auction", { auction, bids, errors });
      }
      await run("BEGIN IMMEDIATE TRANSACTION");
      try {
        const locked = await auctionWithBid(req.params.id);
        if (!locked || new Date(locked.end_time).getTime() <= Date.now() || amount <= locked.current_price_cents) {
          await run("ROLLBACK");
          return res.redirect(`/auctions/${req.params.id}`);
        }
        await run("INSERT INTO bids (auction_id, bidder_id, amount_cents) VALUES (?, ?, ?)", [req.params.id, req.session.user.id, amount]);
        await run("COMMIT");
        res.redirect(`/auctions/${req.params.id}`);
      } catch (err) {
        await run("ROLLBACK");
        throw err;
      }
    } catch (err) {
      next(err);
    }
  }
);

app.get("/my-auctions", requireAuth, async (req, res, next) => {
  try {
    const auctions = await all(`
      SELECT a.id, a.title, a.end_time, a.starting_price_cents,
        COALESCE(MAX(b.amount_cents), a.starting_price_cents) AS current_price_cents
      FROM auctions a
      LEFT JOIN bids b ON b.auction_id = a.id
      WHERE a.seller_id = ?
      GROUP BY a.id
      ORDER BY datetime(a.created_at) DESC
    `, [req.session.user.id]);
    res.render("my-auctions", { auctions });
  } catch (err) {
    next(err);
  }
});

app.use((req, res) => res.status(404).render("not-found"));

app.use((err, req, res, next) => {
  const id = crypto.randomUUID();
  console.error(`Error ${id}:`, err);
  if (err.code === "EBADCSRFTOKEN") {
    return res.status(403).render("error", { message: "Your form expired. Please go back and try again.", id });
  }
  res.status(500).render("error", { message: "Something went wrong. Please try again later.", id });
});

initDb().then(() => {
  const attrs = [{ name: "commonName", value: "localhost" }];
  const pems = selfsigned.generate(attrs, { days: 365, keySize: 2048, algorithm: "sha256" });
  https.createServer({ key: pems.private, cert: pems.cert }, app).listen(PORT, () => {
    console.log(`Auction site listening at https://localhost:${PORT}`);
  });
}).catch(err => {
  console.error("Failed to initialize application.");
  console.error(err);
  process.exit(1);
});
