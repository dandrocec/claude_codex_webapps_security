require("dotenv").config();

const path = require("path");
const express = require("express");
const session = require("express-session");
const SQLiteStoreFactory = require("connect-sqlite3");
const helmet = require("helmet");
const csrf = require("csurf");
const bcrypt = require("bcrypt");
const Database = require("better-sqlite3");
const rateLimit = require("express-rate-limit");
const { body, param, validationResult } = require("express-validator");

const app = express();
const SQLiteStore = SQLiteStoreFactory(session);
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, "expenses.sqlite");
const db = new Database(dbPath);
const PORT = Number(process.env.PORT || 5032);
const SESSION_SECRET = process.env.SESSION_SECRET;
const isProduction = process.env.NODE_ENV === "production";

if (!SESSION_SECRET) {
  throw new Error("SESSION_SECRET environment variable is required");
}

db.pragma("foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
    category TEXT NOT NULL,
    expense_date TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_expenses_user_date ON expenses(user_id, expense_date);
`);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"]
      }
    },
    referrerPolicy: { policy: "no-referrer" }
  })
);
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h", index: false }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));
app.use(
  session({
    store: new SQLiteStore({ db: "sessions.sqlite", dir: __dirname }),
    name: "expense.sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 2
    }
  })
);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false
});
const csrfProtection = csrf();

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

function render(res, view, options = {}) {
  res.render(view, {
    errors: [],
    values: {},
    ...options
  });
}

function collectErrors(req) {
  return validationResult(req).array().map((error) => error.msg);
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function amountToCents(value) {
  const normalized = String(value || "").trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(normalized)) return NaN;
  const [dollars, cents = ""] = normalized.split(".");
  return Number(dollars) * 100 + Number(cents.padEnd(2, "0"));
}

function centsToAmount(cents) {
  return (Number(cents) / 100).toFixed(2);
}

const expenseValidators = [
  body("amount")
    .custom((value) => {
      const cents = amountToCents(value);
      return Number.isInteger(cents) && cents > 0 && cents <= 100000000000;
    })
    .withMessage("Enter a valid positive amount."),
  body("category").trim().isLength({ min: 1, max: 60 }).withMessage("Category is required and must be 60 characters or less."),
  body("date").isISO8601({ strict: true, strictSeparator: true }).withMessage("Enter a valid date."),
  body("note").trim().isLength({ max: 500 }).withMessage("Note must be 500 characters or less.")
];

app.get("/", (req, res) => {
  if (req.session.user) return res.redirect("/expenses");
  res.redirect("/login");
});

app.get("/register", csrfProtection, (req, res) => {
  render(res, "register", { csrfToken: req.csrfToken() });
});

app.post(
  "/register",
  authLimiter,
  csrfProtection,
  body("email").isEmail().withMessage("Enter a valid email address.").normalizeEmail(),
  body("password").isLength({ min: 12, max: 128 }).withMessage("Password must be at least 12 characters."),
  async (req, res, next) => {
    try {
      const errors = collectErrors(req);
      const email = normalizeEmail(req.body.email);
      if (errors.length) {
        return render(res.status(400), "register", { csrfToken: req.csrfToken(), errors, values: { email } });
      }

      const passwordHash = await bcrypt.hash(req.body.password, 12);
      try {
        const result = db.prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)").run(email, passwordHash);
        req.session.regenerate((err) => {
          if (err) return next(err);
          req.session.user = { id: result.lastInsertRowid, email };
          res.redirect("/expenses");
        });
      } catch (err) {
        if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
          return render(res.status(400), "register", {
            csrfToken: req.csrfToken(),
            errors: ["That email is already registered."],
            values: { email }
          });
        }
        throw err;
      }
    } catch (err) {
      next(err);
    }
  }
);

app.get("/login", csrfProtection, (req, res) => {
  render(res, "login", { csrfToken: req.csrfToken() });
});

app.post(
  "/login",
  authLimiter,
  csrfProtection,
  body("email").isEmail().withMessage("Enter a valid email address.").normalizeEmail(),
  body("password").isLength({ min: 1, max: 128 }).withMessage("Password is required."),
  async (req, res, next) => {
    try {
      const errors = collectErrors(req);
      const email = normalizeEmail(req.body.email);
      if (errors.length) {
        return render(res.status(400), "login", { csrfToken: req.csrfToken(), errors, values: { email } });
      }

      const user = db.prepare("SELECT id, email, password_hash FROM users WHERE email = ?").get(email);
      const ok = user && (await bcrypt.compare(req.body.password, user.password_hash));
      if (!ok) {
        return render(res.status(401), "login", {
          csrfToken: req.csrfToken(),
          errors: ["Invalid email or password."],
          values: { email }
        });
      }

      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.user = { id: user.id, email: user.email };
        res.redirect("/expenses");
      });
    } catch (err) {
      next(err);
    }
  }
);

app.post("/logout", csrfProtection, requireAuth, (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie("expense.sid");
    res.redirect("/login");
  });
});

app.get("/expenses", csrfProtection, requireAuth, (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || "") ? req.query.month : new Date().toISOString().slice(0, 7);
  const start = `${month}-01`;
  const endDate = new Date(`${start}T00:00:00.000Z`);
  endDate.setUTCMonth(endDate.getUTCMonth() + 1);
  const end = endDate.toISOString().slice(0, 10);

  const expenses = db
    .prepare(
      "SELECT id, amount_cents, category, expense_date, note FROM expenses WHERE user_id = ? AND expense_date >= ? AND expense_date < ? ORDER BY expense_date DESC, id DESC"
    )
    .all(req.session.user.id, start, end)
    .map((expense) => ({ ...expense, amount: centsToAmount(expense.amount_cents) }));

  const total = db
    .prepare("SELECT COALESCE(SUM(amount_cents), 0) AS total_cents FROM expenses WHERE user_id = ? AND expense_date >= ? AND expense_date < ?")
    .get(req.session.user.id, start, end).total_cents;

  render(res, "expenses", {
    csrfToken: req.csrfToken(),
    expenses,
    month,
    total: centsToAmount(total),
    values: { date: new Date().toISOString().slice(0, 10) }
  });
});

app.post("/expenses", csrfProtection, requireAuth, expenseValidators, (req, res) => {
  const errors = collectErrors(req);
  if (errors.length) {
    return renderExpensesWithErrors(req, res, errors, 400);
  }

  db.prepare("INSERT INTO expenses (user_id, amount_cents, category, expense_date, note) VALUES (?, ?, ?, ?, ?)").run(
    req.session.user.id,
    amountToCents(req.body.amount),
    req.body.category.trim(),
    req.body.date,
    req.body.note.trim() || null
  );
  res.redirect(`/expenses?month=${req.body.date.slice(0, 7)}`);
});

app.get("/expenses/:id/edit", csrfProtection, requireAuth, param("id").isInt({ min: 1 }), (req, res) => {
  const errors = collectErrors(req);
  if (errors.length) return res.status(404).render("not-found");

  const expense = db
    .prepare("SELECT id, amount_cents, category, expense_date, note FROM expenses WHERE id = ? AND user_id = ?")
    .get(Number(req.params.id), req.session.user.id);
  if (!expense) return res.status(404).render("not-found");

  render(res, "edit-expense", {
    csrfToken: req.csrfToken(),
    expense: { ...expense, amount: centsToAmount(expense.amount_cents) }
  });
});

app.post("/expenses/:id/edit", csrfProtection, requireAuth, param("id").isInt({ min: 1 }), expenseValidators, (req, res) => {
  const id = Number(req.params.id);
  const errors = collectErrors(req);
  if (errors.length) {
    return render(res.status(400), "edit-expense", {
      csrfToken: req.csrfToken(),
      errors,
      expense: {
        id,
        amount: req.body.amount,
        category: req.body.category,
        expense_date: req.body.date,
        note: req.body.note
      }
    });
  }

  const result = db
    .prepare(
      "UPDATE expenses SET amount_cents = ?, category = ?, expense_date = ?, note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?"
    )
    .run(amountToCents(req.body.amount), req.body.category.trim(), req.body.date, req.body.note.trim() || null, id, req.session.user.id);

  if (result.changes === 0) return res.status(404).render("not-found");
  res.redirect(`/expenses?month=${req.body.date.slice(0, 7)}`);
});

app.post("/expenses/:id/delete", csrfProtection, requireAuth, param("id").isInt({ min: 1 }), (req, res) => {
  const errors = collectErrors(req);
  if (errors.length) return res.status(404).render("not-found");

  db.prepare("DELETE FROM expenses WHERE id = ? AND user_id = ?").run(Number(req.params.id), req.session.user.id);
  res.redirect("/expenses");
});

function renderExpensesWithErrors(req, res, errors, status) {
  const month = /^\d{4}-\d{2}$/.test(req.body.date || "") ? req.body.date.slice(0, 7) : new Date().toISOString().slice(0, 7);
  const expenses = db
    .prepare(
      "SELECT id, amount_cents, category, expense_date, note FROM expenses WHERE user_id = ? AND substr(expense_date, 1, 7) = ? ORDER BY expense_date DESC, id DESC"
    )
    .all(req.session.user.id, month)
    .map((expense) => ({ ...expense, amount: centsToAmount(expense.amount_cents) }));
  const total = db
    .prepare("SELECT COALESCE(SUM(amount_cents), 0) AS total_cents FROM expenses WHERE user_id = ? AND substr(expense_date, 1, 7) = ?")
    .get(req.session.user.id, month).total_cents;

  return render(res.status(status), "expenses", {
    csrfToken: req.csrfToken(),
    errors,
    expenses,
    month,
    total: centsToAmount(total),
    values: req.body
  });
}

app.use((req, res) => {
  res.status(404).render("not-found");
});

app.use((err, req, res, next) => {
  if (err.code === "EBADCSRFTOKEN") {
    return res.status(403).render("error", { message: "The form expired or was invalid. Please try again." });
  }
  console.error(err);
  res.status(500).render("error", { message: "Something went wrong. Please try again later." });
});

app.listen(PORT, () => {
  console.log(`Expense tracker listening on port ${PORT}`);
});
