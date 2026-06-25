const path = require("path");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const Database = require("better-sqlite3");

const app = express();
const PORT = Number(process.env.PORT || 5048);
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "feedback.db");
const REVIEWER_USERNAME = process.env.REVIEWER_USERNAME || "reviewer";
const REVIEWER_PASSWORD = process.env.REVIEWER_PASSWORD || "reviewer";
const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const allowedCategories = ["Product", "Support", "Website", "Billing", "Other"];
const sortColumns = {
  created_at: "created_at",
  category: "category",
  rating: "rating"
};

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));
app.use(
  session({
    name: "feedback.sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax"
    }
  })
);

app.use((req, res, next) => {
  res.locals.reviewer = Boolean(req.session.reviewer);
  res.locals.categories = allowedCategories;
  next();
});

function requireReviewer(req, res, next) {
  if (!req.session.reviewer) {
    return res.redirect("/login");
  }
  next();
}

function validateFeedback(body) {
  const category = String(body.category || "").trim();
  const rating = Number(body.rating);
  const comment = String(body.comment || "").trim();
  const errors = [];

  if (!allowedCategories.includes(category)) {
    errors.push("Choose a valid category.");
  }

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    errors.push("Choose a rating from 1 to 5.");
  }

  if (comment.length < 5) {
    errors.push("Comment must be at least 5 characters.");
  } else if (comment.length > 1000) {
    errors.push("Comment must be 1000 characters or fewer.");
  }

  return {
    valid: errors.length === 0,
    errors,
    values: { category, rating, comment }
  };
}

app.get("/", (req, res) => {
  res.render("index", {
    title: "Feedback Portal",
    errors: [],
    values: { category: "Product", rating: 5, comment: "" },
    submitted: req.query.submitted === "1"
  });
});

app.post("/feedback", (req, res) => {
  const result = validateFeedback(req.body);

  if (!result.valid) {
    return res.status(422).render("index", {
      title: "Feedback Portal",
      errors: result.errors,
      values: result.values,
      submitted: false
    });
  }

  db.prepare(
    "INSERT INTO feedback (category, rating, comment) VALUES (?, ?, ?)"
  ).run(result.values.category, result.values.rating, result.values.comment);

  res.redirect("/?submitted=1");
});

app.get("/login", (req, res) => {
  if (req.session.reviewer) {
    return res.redirect("/review");
  }

  res.render("login", {
    title: "Reviewer Login",
    error: null,
    username: REVIEWER_USERNAME
  });
});

app.post("/login", (req, res) => {
  const username = String(req.body.username || "");
  const password = String(req.body.password || "");

  if (username === REVIEWER_USERNAME && password === REVIEWER_PASSWORD) {
    req.session.reviewer = true;
    return res.redirect("/review");
  }

  res.status(401).render("login", {
    title: "Reviewer Login",
    error: "Invalid username or password.",
    username
  });
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

app.get("/review", requireReviewer, (req, res) => {
  const requestedSort = String(req.query.sort || "created_at");
  const sort = sortColumns[requestedSort] ? requestedSort : "created_at";
  const order = String(req.query.order || "desc").toLowerCase() === "asc" ? "asc" : "desc";
  const nextOrder = order === "asc" ? "desc" : "asc";

  const rows = db
    .prepare(
      `SELECT id, category, rating, comment, created_at
       FROM feedback
       ORDER BY ${sortColumns[sort]} ${order.toUpperCase()}, id ${order.toUpperCase()}`
    )
    .all();

  res.render("review", {
    title: "Reviewer Dashboard",
    feedback: rows,
    sort,
    order,
    nextOrder
  });
});

app.use((req, res) => {
  res.status(404).render("not-found", { title: "Page Not Found" });
});

app.listen(PORT, () => {
  console.log(`Feedback portal running on http://localhost:${PORT}`);
});
