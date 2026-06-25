require("dotenv").config();

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const SQLiteStoreFactory = require("connect-sqlite3");
const helmet = require("helmet");
const csrf = require("csurf");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcrypt");
const sqlite3 = require("sqlite3").verbose();
const { body, validationResult } = require("express-validator");

const app = express();
const SQLiteStore = SQLiteStoreFactory(session);
const isProduction = process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT || 5002);
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const dataDir = path.join(__dirname, "data");

require("fs").mkdirSync(dataDir, { recursive: true });

if (!process.env.SESSION_SECRET) {
  console.warn("SESSION_SECRET is not set. A temporary secret was generated for this process.");
}

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.disable("x-powered-by");

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"]
      }
    },
    crossOriginEmbedderPolicy: false
  })
);

app.use(express.urlencoded({ extended: false, limit: "10kb" }));
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h", index: false }));

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: true,
    legacyHeaders: false
  })
);

app.use(
  session({
    store: new SQLiteStore({ db: "sessions.sqlite", dir: dataDir }),
    name: "sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      maxAge: 60 * 60 * 1000
    }
  })
);

const db = new sqlite3.Database(path.join(dataDir, "app.sqlite"));
db.serialize(() => {
  db.run(
    "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL)"
  );
  db.run(
    "CREATE TABLE IF NOT EXISTS bmi_results (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, height_cm REAL NOT NULL, weight_kg REAL NOT NULL, bmi REAL NOT NULL, category TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id))"
  );
});

function runQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function getQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

async function ensureDemoUser(req, res, next) {
  try {
    if (req.session.userId) {
      return next();
    }

    const demoEmail = "demo@example.test";
    const demoPassword = process.env.DEMO_PASSWORD || crypto.randomBytes(24).toString("hex");
    const existing = await getQuery("SELECT id FROM users WHERE email = ?", [demoEmail]);

    if (existing) {
      req.session.userId = existing.id;
      return next();
    }

    const passwordHash = await bcrypt.hash(demoPassword, 12);
    const result = await runQuery("INSERT INTO users (email, password_hash) VALUES (?, ?)", [
      demoEmail,
      passwordHash
    ]);
    req.session.userId = result.lastID;
    next();
  } catch (err) {
    next(err);
  }
}

function requireOwner(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).render("error", { message: "Authentication required." });
  }
  next();
}

function bmiCategory(bmi) {
  if (bmi < 18.5) return "underweight";
  if (bmi < 25) return "normal";
  if (bmi < 30) return "overweight";
  return "obese";
}

const csrfProtection = csrf();
app.use(ensureDemoUser);
app.use(csrfProtection);

app.get("/", (req, res) => {
  res.render("index", {
    csrfToken: req.csrfToken(),
    values: { height: "", weight: "" },
    errors: [],
    result: null
  });
});

app.post(
  "/bmi",
  requireOwner,
  [
    body("height")
      .trim()
      .isFloat({ min: 50, max: 272 })
      .withMessage("Height must be a number between 50 and 272 cm.")
      .toFloat(),
    body("weight")
      .trim()
      .isFloat({ min: 2, max: 700 })
      .withMessage("Weight must be a number between 2 and 700 kg.")
      .toFloat()
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    const values = {
      height: req.body.height,
      weight: req.body.weight
    };

    if (!errors.isEmpty()) {
      return res.status(400).render("index", {
        csrfToken: req.csrfToken(),
        values,
        errors: errors.array(),
        result: null
      });
    }

    try {
      const heightCm = Number(req.body.height);
      const weightKg = Number(req.body.weight);
      const bmi = weightKg / Math.pow(heightCm / 100, 2);
      const roundedBmi = Number(bmi.toFixed(1));
      const category = bmiCategory(roundedBmi);

      const inserted = await runQuery(
        "INSERT INTO bmi_results (user_id, height_cm, weight_kg, bmi, category) VALUES (?, ?, ?, ?, ?)",
        [req.session.userId, heightCm, weightKg, roundedBmi, category]
      );

      const result = await getQuery(
        "SELECT id, bmi, category FROM bmi_results WHERE id = ? AND user_id = ?",
        [inserted.lastID, req.session.userId]
      );

      res.render("index", {
        csrfToken: req.csrfToken(),
        values,
        errors: [],
        result
      });
    } catch (err) {
      next(err);
    }
  }
);

app.use((req, res) => {
  res.status(404).render("error", { message: "Page not found." });
});

app.use((err, req, res, next) => {
  console.error(err);

  if (err.code === "EBADCSRFTOKEN") {
    return res.status(403).render("error", { message: "Invalid or expired form token." });
  }

  res.status(500).render("error", { message: "An internal error occurred." });
});

process.on("SIGINT", () => {
  db.close(() => process.exit(0));
});

app.listen(PORT, () => {
  console.log(`BMI app listening on http://localhost:${PORT}`);
});
