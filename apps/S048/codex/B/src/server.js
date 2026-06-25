require("dotenv").config();

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const helmet = require("helmet");
const csrf = require("csurf");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcrypt");
const Database = require("better-sqlite3");
const validator = require("validator");
const { z } = require("zod");

const app = express();
const port = Number.parseInt(process.env.PORT || "5048", 10);
const sessionSecret = process.env.SESSION_SECRET;

if (!sessionSecret || sessionSecret.length < 32) {
  throw new Error("SESSION_SECRET must be set to at least 32 characters.");
}

const databasePath = process.env.DB_PATH || path.join(__dirname, "..", "data", "feedback.sqlite");
const databaseDir = path.dirname(databasePath);
fs.mkdirSync(databaseDir, { recursive: true });

const db = new Database(databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('reviewer')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

const reviewerEmail = process.env.REVIEWER_EMAIL;
const reviewerPassword = process.env.REVIEWER_PASSWORD;

if (reviewerEmail && reviewerPassword) {
  if (!validator.isEmail(reviewerEmail) || reviewerPassword.length < 12) {
    throw new Error("REVIEWER_EMAIL must be valid and REVIEWER_PASSWORD must be at least 12 characters.");
  }

  const existingReviewer = db.prepare("SELECT id FROM users WHERE email = ?").get(reviewerEmail.toLowerCase());
  if (!existingReviewer) {
    const passwordHash = bcrypt.hashSync(reviewerPassword, 12);
    db.prepare("INSERT INTO users (email, password_hash, role) VALUES (?, ?, 'reviewer')")
      .run(reviewerEmail.toLowerCase(), passwordHash);
  }
}

const insertFeedback = db.prepare("INSERT INTO feedback (category, rating, comment) VALUES (?, ?, ?)");
const findUserByEmail = db.prepare("SELECT id, email, password_hash, role FROM users WHERE email = ?");

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.set("trust proxy", 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

app.use(express.urlencoded({ extended: false, limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public"), {
  etag: true,
  index: false,
  maxAge: "1h"
}));

app.use(session({
  name: "feedback.sid",
  store: new SQLiteStore({ db: "sessions.sqlite", dir: databaseDir }),
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE !== "false",
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 2
  }
}));

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.notice = req.session.notice || null;
  res.locals.error = req.session.error || null;
  res.locals.csrfToken = "";
  delete req.session.notice;
  delete req.session.error;
  next();
});

const csrfProtection = csrf();
app.use(csrfProtection);

app.use((req, res, next) => {
  res.locals.csrfToken = req.csrfToken();
  next();
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false
});

const feedbackSchema = z.object({
  category: z.enum(["Bug", "Feature Request", "Praise", "Complaint", "Other"]),
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().trim().min(5).max(2000).transform((value) => validator.stripLow(value, true))
});

const loginSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(512)
});

function requireReviewer(req, res, next) {
  if (!req.session.user || req.session.user.role !== "reviewer") {
    req.session.error = "Please sign in as a reviewer.";
    return res.redirect("/login");
  }
  return next();
}

function getSortClause(sort, direction) {
  const sortMap = {
    created: "created_at",
    category: "category",
    rating: "rating"
  };
  const column = sortMap[sort] || "created_at";
  const order = direction === "asc" ? "ASC" : "DESC";
  return { column, order, sort: sortMap[sort] ? sort : "created", direction: order === "ASC" ? "asc" : "desc" };
}

app.get("/", (req, res) => {
  res.render("feedback", {
    title: "Submit Feedback",
    form: { category: "Other", rating: "5", comment: "" },
    validationErrors: []
  });
});

app.post("/feedback", (req, res) => {
  const parsed = feedbackSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).render("feedback", {
      title: "Submit Feedback",
      form: {
        category: req.body.category || "Other",
        rating: req.body.rating || "5",
        comment: req.body.comment || ""
      },
      validationErrors: parsed.error.issues.map((issue) => issue.message)
    });
  }

  insertFeedback.run(parsed.data.category, parsed.data.rating, parsed.data.comment);
  req.session.notice = "Feedback submitted.";
  return res.redirect("/");
});

app.get("/login", (req, res) => {
  if (req.session.user) {
    return res.redirect("/reviewer/feedback");
  }
  return res.render("login", { title: "Reviewer Login", validationErrors: [] });
});

app.post("/login", authLimiter, async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).render("login", {
        title: "Reviewer Login",
        validationErrors: ["Enter a valid email address and password."]
      });
    }

    const user = findUserByEmail.get(parsed.data.email);
    const passwordMatches = user ? await bcrypt.compare(parsed.data.password, user.password_hash) : false;
    if (!user || !passwordMatches || user.role !== "reviewer") {
      return res.status(401).render("login", {
        title: "Reviewer Login",
        validationErrors: ["Invalid email or password."]
      });
    }

    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = { id: user.id, email: user.email, role: user.role };
      req.session.notice = "Signed in.";
      return res.redirect("/reviewer/feedback");
    });
  } catch (err) {
    next(err);
  }
});

app.post("/logout", requireReviewer, (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie("feedback.sid");
    return res.redirect("/");
  });
});

app.get("/reviewer/feedback", requireReviewer, (req, res) => {
  const { column, order, sort, direction } = getSortClause(req.query.sort, req.query.direction);
  const rows = db.prepare(`
    SELECT id, category, rating, comment, created_at
    FROM feedback
    ORDER BY ${column} ${order}, id DESC
  `).all();

  res.render("reviewer-feedback", {
    title: "All Feedback",
    feedback: rows,
    sort,
    direction
  });
});

app.use((req, res) => {
  res.status(404).render("error", {
    title: "Not Found",
    status: 404,
    message: "The requested page was not found."
  });
});

app.use((err, req, res, next) => {
  if (err.code === "EBADCSRFTOKEN") {
    return res.status(403).render("error", {
      title: "Forbidden",
      status: 403,
      message: "The form expired or was invalid. Please try again."
    });
  }

  const requestId = crypto.randomUUID();
  console.error({ requestId, err });
  return res.status(500).render("error", {
    title: "Server Error",
    status: 500,
    message: `Something went wrong. Reference: ${requestId}`
  });
});

app.listen(port, () => {
  console.log(`Feedback portal listening on port ${port}`);
});
