require("dotenv").config();

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");
const cookieParser = require("cookie-parser");
const express = require("express");
const rateLimit = require("express-rate-limit");
const session = require("express-session");
const SQLiteStoreFactory = require("connect-sqlite3");
const helmet = require("helmet");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const { body, param, validationResult } = require("express-validator");

const PORT = Number(process.env.PORT || 5043);
const SESSION_SECRET = process.env.SESSION_SECRET;
const COOKIE_SECRET = process.env.COOKIE_SECRET;
const DB_FILE = process.env.DATABASE_FILE || path.join(__dirname, "data", "polls.sqlite");
const COOKIE_SECURE = process.env.COOKIE_SECURE === "true" || process.env.NODE_ENV === "production";

if (!SESSION_SECRET || !COOKIE_SECRET) {
  console.error("SESSION_SECRET and COOKIE_SECRET must be set in the environment.");
  process.exit(1);
}

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });

const app = express();
const SQLiteStore = SQLiteStoreFactory(session);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.set("trust proxy", 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginOpenerPolicy: { policy: "same-origin" },
  referrerPolicy: { policy: "no-referrer" }
}));
app.disable("x-powered-by");

app.use(express.static(path.join(__dirname, "public"), {
  etag: true,
  maxAge: "1h",
  index: false
}));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));
app.use(express.json({ limit: "20kb" }));
app.use(cookieParser(COOKIE_SECRET));
app.use(session({
  name: "poll.sid",
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: new SQLiteStore({ db: "sessions.sqlite", dir: path.join(__dirname, "data") }),
  cookie: {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 4
  }
}));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: "draft-8",
  legacyHeaders: false
}));

let db;

function normaliseText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function csrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  }
  return req.session.csrfToken;
}

function requireCsrf(req, res, next) {
  const submitted = req.body && req.body._csrf;
  if (!submitted || submitted !== req.session.csrfToken) {
    return res.status(403).render("error", {
      title: "Request blocked",
      message: "The form security token was invalid. Please reload the page and try again."
    });
  }
  return next();
}

function requireLogin(req, res, next) {
  if (!req.session.user) {
    req.session.returnTo = req.originalUrl;
    return res.redirect("/login");
  }
  return next();
}

function flash(req, type, message) {
  req.session.flash = { type, message };
}

function formErrors(req) {
  const result = validationResult(req);
  return result.isEmpty() ? [] : result.array().map((err) => err.msg);
}

async function getPollWithOptions(pollId) {
  const poll = await db.get(
    "SELECT polls.id, polls.title, polls.description, polls.owner_id, polls.created_at, users.username AS owner_name FROM polls JOIN users ON users.id = polls.owner_id WHERE polls.id = ?",
    pollId
  );
  if (!poll) return null;
  poll.options = await db.all(
    "SELECT id, label FROM poll_options WHERE poll_id = ? ORDER BY id ASC",
    pollId
  );
  return poll;
}

async function getResults(pollId) {
  return db.all(
    `SELECT poll_options.id, poll_options.label, COUNT(votes.id) AS votes
     FROM poll_options
     LEFT JOIN votes ON votes.option_id = poll_options.id
     WHERE poll_options.poll_id = ?
     GROUP BY poll_options.id
     ORDER BY poll_options.id ASC`,
    pollId
  );
}

function voterKey(req, res) {
  if (req.session.user) return `user:${req.session.user.id}`;
  let key = req.signedCookies.voter_id;
  if (!key) {
    key = crypto.randomUUID();
    res.cookie("voter_id", key, {
      httpOnly: true,
      secure: COOKIE_SECURE,
      sameSite: "lax",
      signed: true,
      maxAge: 1000 * 60 * 60 * 24 * 365
    });
  }
  return `anon:${key}`;
}

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.csrfToken = csrfToken(req);
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
});

app.get("/", async (req, res, next) => {
  try {
    const polls = await db.all(
      `SELECT polls.id, polls.title, polls.description, polls.created_at, users.username AS owner_name,
        COALESCE(COUNT(votes.id), 0) AS vote_count
       FROM polls
       JOIN users ON users.id = polls.owner_id
       LEFT JOIN votes ON votes.poll_id = polls.id
       GROUP BY polls.id
       ORDER BY polls.created_at DESC
       LIMIT 50`
    );
    res.render("index", { title: "Polls", polls });
  } catch (err) {
    next(err);
  }
});

app.get("/register", (req, res) => {
  res.render("register", { title: "Create account", errors: [], values: {} });
});

app.post("/register",
  requireCsrf,
  body("username").trim().isLength({ min: 3, max: 40 }).withMessage("Username must be 3 to 40 characters.").matches(/^[A-Za-z0-9_.-]+$/).withMessage("Username may contain letters, numbers, dot, dash, and underscore."),
  body("password").isLength({ min: 12, max: 128 }).withMessage("Password must be 12 to 128 characters."),
  async (req, res, next) => {
    const errors = formErrors(req);
    const username = normaliseText(req.body.username);
    if (errors.length) {
      return res.status(400).render("register", { title: "Create account", errors, values: { username } });
    }
    try {
      const passwordHash = await bcrypt.hash(req.body.password, 12);
      const result = await db.run(
        "INSERT INTO users (username, password_hash) VALUES (?, ?)",
        username,
        passwordHash
      );
      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.user = { id: result.lastID, username };
        res.redirect("/");
      });
    } catch (err) {
      if (err && err.code === "SQLITE_CONSTRAINT") {
        return res.status(409).render("register", {
          title: "Create account",
          errors: ["That username is already taken."],
          values: { username }
        });
      }
      return next(err);
    }
  }
);

app.get("/login", (req, res) => {
  res.render("login", { title: "Sign in", errors: [], values: {} });
});

app.post("/login",
  requireCsrf,
  body("username").trim().isLength({ min: 1, max: 40 }).withMessage("Enter your username."),
  body("password").isLength({ min: 1, max: 128 }).withMessage("Enter your password."),
  async (req, res, next) => {
    const errors = formErrors(req);
    const username = normaliseText(req.body.username);
    if (errors.length) {
      return res.status(400).render("login", { title: "Sign in", errors, values: { username } });
    }
    try {
      const user = await db.get("SELECT id, username, password_hash FROM users WHERE username = ?", username);
      const ok = user ? await bcrypt.compare(req.body.password, user.password_hash) : false;
      if (!ok) {
        return res.status(401).render("login", {
          title: "Sign in",
          errors: ["Invalid username or password."],
          values: { username }
        });
      }
      const target = req.session.returnTo || "/";
      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.user = { id: user.id, username: user.username };
        res.redirect(target);
      });
    } catch (err) {
      next(err);
    }
  }
);

app.post("/logout", requireCsrf, (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie("poll.sid");
    res.redirect("/");
  });
});

app.get("/polls/new", requireLogin, (req, res) => {
  res.render("new-poll", {
    title: "New poll",
    errors: [],
    values: { title: "", description: "", options: ["", "", ""] }
  });
});

app.post("/polls",
  requireLogin,
  requireCsrf,
  body("title").trim().isLength({ min: 3, max: 120 }).withMessage("Poll title must be 3 to 120 characters."),
  body("description").optional({ checkFalsy: true }).trim().isLength({ max: 500 }).withMessage("Description must be 500 characters or fewer."),
  body("options").custom((value) => {
    const options = Array.isArray(value) ? value : [value];
    const clean = options.map(normaliseText).filter(Boolean);
    if (clean.length < 2 || clean.length > 8) throw new Error("Provide 2 to 8 non-empty options.");
    if (new Set(clean.map((item) => item.toLowerCase())).size !== clean.length) throw new Error("Poll options must be unique.");
    if (clean.some((item) => item.length > 120)) throw new Error("Each option must be 120 characters or fewer.");
    return true;
  }),
  async (req, res, next) => {
    const rawOptions = Array.isArray(req.body.options) ? req.body.options : [req.body.options];
    const values = {
      title: normaliseText(req.body.title),
      description: normaliseText(req.body.description),
      options: rawOptions.map(normaliseText)
    };
    const errors = formErrors(req);
    if (errors.length) {
      return res.status(400).render("new-poll", { title: "New poll", errors, values });
    }
    const options = values.options.filter(Boolean);
    try {
      await db.run("BEGIN");
      const poll = await db.run(
        "INSERT INTO polls (owner_id, title, description) VALUES (?, ?, ?)",
        req.session.user.id,
        values.title,
        values.description
      );
      for (const option of options) {
        await db.run("INSERT INTO poll_options (poll_id, label) VALUES (?, ?)", poll.lastID, option);
      }
      await db.run("COMMIT");
      res.redirect(`/polls/${poll.lastID}`);
    } catch (err) {
      await db.run("ROLLBACK").catch(() => {});
      next(err);
    }
  }
);

app.get("/polls/:id",
  param("id").isInt({ min: 1 }).withMessage("Invalid poll id."),
  async (req, res, next) => {
    if (!validationResult(req).isEmpty()) return res.status(404).render("error", { title: "Not found", message: "Poll not found." });
    try {
      const poll = await getPollWithOptions(Number(req.params.id));
      if (!poll) return res.status(404).render("error", { title: "Not found", message: "Poll not found." });
      const key = voterKey(req, res);
      const existingVote = await db.get("SELECT option_id FROM votes WHERE poll_id = ? AND voter_key = ?", poll.id, key);
      const results = await getResults(poll.id);
      res.render("poll", {
        title: poll.title,
        poll,
        existingVote,
        results,
        totalVotes: results.reduce((sum, row) => sum + row.votes, 0),
        isOwner: req.session.user && req.session.user.id === poll.owner_id
      });
    } catch (err) {
      next(err);
    }
  }
);

app.post("/polls/:id/vote",
  requireCsrf,
  param("id").isInt({ min: 1 }).withMessage("Invalid poll id."),
  body("option_id").isInt({ min: 1 }).withMessage("Choose a valid option."),
  async (req, res, next) => {
    if (!validationResult(req).isEmpty()) {
      return res.status(400).render("error", { title: "Invalid vote", message: "The selected option is invalid." });
    }
    const pollId = Number(req.params.id);
    const optionId = Number(req.body.option_id);
    try {
      const option = await db.get("SELECT id FROM poll_options WHERE id = ? AND poll_id = ?", optionId, pollId);
      if (!option) return res.status(400).render("error", { title: "Invalid vote", message: "The selected option is invalid." });
      await db.run(
        "INSERT INTO votes (poll_id, option_id, voter_key) VALUES (?, ?, ?)",
        pollId,
        optionId,
        voterKey(req, res)
      );
      res.redirect(`/polls/${pollId}`);
    } catch (err) {
      if (err && err.code === "SQLITE_CONSTRAINT") {
        flash(req, "info", "You have already voted in this poll.");
        return res.redirect(`/polls/${pollId}`);
      }
      next(err);
    }
  }
);

app.get("/polls/:id/results.json",
  param("id").isInt({ min: 1 }).withMessage("Invalid poll id."),
  async (req, res, next) => {
    if (!validationResult(req).isEmpty()) return res.status(404).json({ error: "Not found" });
    try {
      const poll = await db.get("SELECT id FROM polls WHERE id = ?", Number(req.params.id));
      if (!poll) return res.status(404).json({ error: "Not found" });
      const results = await getResults(poll.id);
      res.json({
        totalVotes: results.reduce((sum, row) => sum + row.votes, 0),
        results: results.map((row) => ({ id: row.id, label: row.label, votes: row.votes }))
      });
    } catch (err) {
      next(err);
    }
  }
);

app.post("/polls/:id/delete",
  requireLogin,
  requireCsrf,
  param("id").isInt({ min: 1 }).withMessage("Invalid poll id."),
  async (req, res, next) => {
    if (!validationResult(req).isEmpty()) return res.status(404).render("error", { title: "Not found", message: "Poll not found." });
    try {
      const result = await db.run(
        "DELETE FROM polls WHERE id = ? AND owner_id = ?",
        Number(req.params.id),
        req.session.user.id
      );
      if (!result.changes) return res.status(403).render("error", { title: "Forbidden", message: "You cannot modify that poll." });
      res.redirect("/");
    } catch (err) {
      next(err);
    }
  }
);

app.use((req, res) => {
  res.status(404).render("error", { title: "Not found", message: "The requested page was not found." });
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).render("error", {
    title: "Server error",
    message: "Something went wrong. Please try again later."
  });
});

async function initDb() {
  db = await open({ filename: DB_FILE, driver: sqlite3.Database });
  await db.exec("PRAGMA foreign_keys = ON");
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS polls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS poll_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      poll_id INTEGER NOT NULL,
      label TEXT NOT NULL,
      FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      poll_id INTEGER NOT NULL,
      option_id INTEGER NOT NULL,
      voter_key TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (poll_id, voter_key),
      FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE,
      FOREIGN KEY (option_id) REFERENCES poll_options(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_poll_options_poll_id ON poll_options(poll_id);
    CREATE INDEX IF NOT EXISTS idx_votes_poll_id ON votes(poll_id);
  `);
}

initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`Polling app listening on port ${PORT}`);
  });
}).catch((err) => {
  console.error("Failed to initialise database", err);
  process.exit(1);
});
