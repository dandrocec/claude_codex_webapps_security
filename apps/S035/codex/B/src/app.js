require("dotenv").config();

const path = require("path");
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const csrf = require("csurf");
const bcrypt = require("bcrypt");
const rateLimit = require("express-rate-limit");
const { body, validationResult } = require("express-validator");
const sanitizeHtml = require("sanitize-html");
const { openDatabase } = require("./db");
const { currentStreak } = require("./streaks");

const app = express();
const db = openDatabase(process.env.DATABASE_PATH || path.join(__dirname, "..", "data", "habits.sqlite"));
const PORT = Number(process.env.PORT || 5035);
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  throw new Error("SESSION_SECRET must be set to at least 32 characters.");
}

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: null
      }
    },
    referrerPolicy: { policy: "no-referrer" }
  })
);
app.use(express.urlencoded({ extended: false, limit: "20kb" }));
app.use(
  session({
    name: "habit.sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.COOKIE_SECURE === "false" ? false : true,
      sameSite: "strict",
      maxAge: 1000 * 60 * 60 * 2
    }
  })
);

const csrfProtection = csrf();
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many attempts. Try again later."
});

function cleanText(value) {
  return sanitizeHtml(String(value || "").trim(), { allowedTags: [], allowedAttributes: {} });
}

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.redirect("/login");
  }
  return next();
}

function renderAuth(req, res, view, status = 200, errors = []) {
  res.status(status).render(view, {
    csrfToken: req.csrfToken(),
    errors,
    form: req.body || {}
  });
}

function collectErrors(req) {
  return validationResult(req)
    .array()
    .map((error) => error.msg);
}

app.get("/", (req, res) => {
  res.redirect(req.session.userId ? "/habits" : "/login");
});

app.get("/register", csrfProtection, (req, res) => renderAuth(req, res, "register"));

app.post(
  "/register",
  authLimiter,
  csrfProtection,
  body("username")
    .trim()
    .isLength({ min: 3, max: 32 })
    .withMessage("Username must be 3 to 32 characters.")
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage("Username may contain only letters, numbers, and underscores."),
  body("password")
    .isLength({ min: 12, max: 128 })
    .withMessage("Password must be 12 to 128 characters."),
  async (req, res, next) => {
    try {
      const errors = collectErrors(req);
      if (errors.length) return renderAuth(req, res, "register", 400, errors);

      const username = cleanText(req.body.username);
      const passwordHash = await bcrypt.hash(req.body.password, 12);
      const stmt = db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)");

      try {
        const result = stmt.run(username, passwordHash);
        req.session.regenerate((err) => {
          if (err) return next(err);
          req.session.userId = result.lastInsertRowid;
          req.session.username = username;
          return res.redirect("/habits");
        });
      } catch (err) {
        if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
          return renderAuth(req, res, "register", 409, ["That username is already taken."]);
        }
        throw err;
      }
    } catch (err) {
      next(err);
    }
  }
);

app.get("/login", csrfProtection, (req, res) => renderAuth(req, res, "login"));

app.post(
  "/login",
  authLimiter,
  csrfProtection,
  body("username").trim().isLength({ min: 3, max: 32 }).withMessage("Enter a valid username."),
  body("password").isLength({ min: 1, max: 128 }).withMessage("Enter your password."),
  async (req, res, next) => {
    try {
      const errors = collectErrors(req);
      if (errors.length) return renderAuth(req, res, "login", 400, errors);

      const username = cleanText(req.body.username);
      const user = db.prepare("SELECT id, username, password_hash FROM users WHERE username = ?").get(username);
      const valid = user ? await bcrypt.compare(req.body.password, user.password_hash) : false;

      if (!valid) {
        return renderAuth(req, res, "login", 401, ["Invalid username or password."]);
      }

      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.userId = user.id;
        req.session.username = user.username;
        return res.redirect("/habits");
      });
    } catch (err) {
      next(err);
    }
  }
);

app.post("/logout", csrfProtection, requireAuth, (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie("habit.sid");
    return res.redirect("/login");
  });
});

app.get("/habits", csrfProtection, requireAuth, (req, res, next) => {
  try {
    const habits = db
      .prepare(
        `SELECT h.id, h.name, h.created_at,
                EXISTS(
                  SELECT 1 FROM completions c
                  WHERE c.habit_id = h.id AND c.completed_on = date('now', 'localtime')
                ) AS completed_today
         FROM habits h
         WHERE h.user_id = ?
         ORDER BY h.created_at DESC`
      )
      .all(req.session.userId)
      .map((habit) => ({
        ...habit,
        streak: currentStreak(db, req.session.userId, habit.id)
      }));

    res.render("habits", {
      csrfToken: req.csrfToken(),
      username: req.session.username,
      habits,
      errors: []
    });
  } catch (err) {
    next(err);
  }
});

app.post(
  "/habits",
  csrfProtection,
  requireAuth,
  body("name")
    .customSanitizer(cleanText)
    .isLength({ min: 1, max: 80 })
    .withMessage("Habit name must be 1 to 80 characters."),
  (req, res, next) => {
    try {
      const errors = collectErrors(req);
      if (errors.length) return res.status(400).redirect("/habits");

      db.prepare("INSERT INTO habits (user_id, name) VALUES (?, ?)").run(req.session.userId, req.body.name);
      res.redirect("/habits");
    } catch (err) {
      next(err);
    }
  }
);

app.post(
  "/habits/:id/toggle",
  csrfProtection,
  requireAuth,
  body("completed")
    .optional()
    .isIn(["on"])
    .withMessage("Invalid completion value."),
  (req, res, next) => {
    try {
      const errors = collectErrors(req);
      if (errors.length) return res.status(400).render("error", { message: "Invalid request." });

      const habitId = Number.parseInt(req.params.id, 10);
      if (!Number.isSafeInteger(habitId) || habitId < 1) return res.status(404).send("Not found.");

      const habit = db.prepare("SELECT id FROM habits WHERE id = ? AND user_id = ?").get(habitId, req.session.userId);
      if (!habit) return res.status(404).send("Not found.");

      if (req.body.completed === "on") {
        db.prepare("INSERT OR IGNORE INTO completions (habit_id, completed_on) VALUES (?, date('now', 'localtime'))").run(habitId);
      } else {
        db.prepare("DELETE FROM completions WHERE habit_id = ? AND completed_on = date('now', 'localtime')").run(habitId);
      }
      res.redirect("/habits");
    } catch (err) {
      next(err);
    }
  }
);

app.post("/habits/:id/delete", csrfProtection, requireAuth, (req, res, next) => {
  try {
    const habitId = Number.parseInt(req.params.id, 10);
    if (!Number.isSafeInteger(habitId) || habitId < 1) return res.status(404).send("Not found.");

    const result = db.prepare("DELETE FROM habits WHERE id = ? AND user_id = ?").run(habitId, req.session.userId);
    if (!result.changes) return res.status(404).send("Not found.");
    res.redirect("/habits");
  } catch (err) {
    next(err);
  }
});

app.use((req, res) => {
  res.status(404).render("error", { message: "Page not found." });
});

app.use((err, req, res, next) => {
  if (err.code === "EBADCSRFTOKEN") {
    return res.status(403).render("error", { message: "Invalid or expired form token." });
  }
  console.error(err);
  return res.status(500).render("error", { message: "Something went wrong." });
});

app.listen(PORT, () => {
  console.log(`Habit tracker listening on port ${PORT}`);
});
