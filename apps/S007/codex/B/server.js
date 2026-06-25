require("dotenv").config();

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const SQLiteStoreFactory = require("connect-sqlite3");
const helmet = require("helmet");
const csrf = require("csurf");
const rateLimit = require("express-rate-limit");
const validator = require("validator");
const argon2 = require("argon2");
const Database = require("better-sqlite3");

const app = express();
const SQLiteStore = SQLiteStoreFactory(session);
const db = new Database(process.env.DATABASE_PATH || path.join(__dirname, "app.sqlite"));

const PORT = Number.parseInt(process.env.PORT || "5007", 10);
const SESSION_SECRET = process.env.SESSION_SECRET;
const NODE_ENV = process.env.NODE_ENV || "development";
const isProduction = NODE_ENV === "production";

if (!SESSION_SECRET) {
  throw new Error("SESSION_SECRET environment variable is required.");
}

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS palettes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    base_hex TEXT NOT NULL,
    shades_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
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
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        upgradeInsecureRequests: isProduction ? [] : null
      }
    },
    crossOriginEmbedderPolicy: false
  })
);

app.use(express.urlencoded({ extended: false, limit: "10kb" }));
app.use(express.static(path.join(__dirname, "public"), { fallthrough: false }));

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: true,
    legacyHeaders: false
  })
);

app.get("/swatch/:hex.svg", (req, res) => {
  const hex = normalizeHex(req.params.hex);
  if (!hex) {
    return res.status(404).type("image/svg+xml").send("");
  }

  res
    .type("image/svg+xml")
    .set("Cache-Control", "public, max-age=31536000, immutable")
    .send(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><rect width="20" height="20" fill="${hex}"/></svg>`);
});

app.use(
  session({
    store: new SQLiteStore({
      db: "sessions.sqlite",
      dir: __dirname
    }),
    name: "palette.sid",
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

app.use(csrf());

app.use((req, res, next) => {
  res.locals.csrfToken = req.csrfToken();
  res.locals.user = req.session.user || null;
  res.locals.error = null;
  next();
});

function normalizeHex(input) {
  const value = String(input || "").trim();
  if (!validator.matches(value, /^#?[0-9a-fA-F]{6}$/)) {
    return null;
  }
  return `#${value.replace("#", "").toUpperCase()}`;
}

function sanitizeUsername(input) {
  const value = String(input || "").trim();
  if (!validator.matches(value, /^[A-Za-z0-9_-]{3,32}$/)) {
    return null;
  }
  return value;
}

function hexToRgb(hex) {
  const clean = hex.slice(1);
  return {
    r: Number.parseInt(clean.slice(0, 2), 16),
    g: Number.parseInt(clean.slice(2, 4), 16),
    b: Number.parseInt(clean.slice(4, 6), 16)
  };
}

function rgbToHex({ r, g, b }) {
  return `#${[r, g, b]
    .map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

function mix(rgb, target, amount) {
  return {
    r: rgb.r + (target.r - rgb.r) * amount,
    g: rgb.g + (target.g - rgb.g) * amount,
    b: rgb.b + (target.b - rgb.b) * amount
  };
}

function generatePalette(baseHex) {
  const base = hexToRgb(baseHex);
  const white = { r: 255, g: 255, b: 255 };
  const black = { r: 0, g: 0, b: 0 };

  return [
    rgbToHex(mix(base, white, 0.55)),
    rgbToHex(mix(base, white, 0.28)),
    baseHex,
    rgbToHex(mix(base, black, 0.22)),
    rgbToHex(mix(base, black, 0.42))
  ];
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/login");
  }
  return next();
}

function renderHome(req, res, options = {}) {
  const palettes = req.session.user
    ? db
        .prepare("SELECT id, base_hex, shades_json, created_at FROM palettes WHERE user_id = ? ORDER BY id DESC LIMIT 10")
        .all(req.session.user.id)
        .map((row) => ({
          ...row,
          shades: JSON.parse(row.shades_json)
        }))
    : [];

  res.render("index", {
    title: "Palette Generator",
    baseHex: options.baseHex || "#4F46E5",
    shades: options.shades || generatePalette("#4F46E5"),
    palettes,
    error: options.error || null
  });
}

app.get("/", (req, res) => {
  renderHome(req, res);
});

app.post("/palette", requireAuth, (req, res) => {
  const baseHex = normalizeHex(req.body.baseHex);
  if (!baseHex) {
    return renderHome(req, res, { error: "Enter a valid six-digit hex colour, such as #4F46E5." });
  }

  const shades = generatePalette(baseHex);
  db.prepare("INSERT INTO palettes (user_id, base_hex, shades_json) VALUES (?, ?, ?)").run(
    req.session.user.id,
    baseHex,
    JSON.stringify(shades)
  );

  return renderHome(req, res, { baseHex, shades });
});

app.get("/palette/:id", requireAuth, (req, res) => {
  const paletteId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(paletteId) || paletteId < 1) {
    return res.status(404).render("error", { title: "Not found", message: "Palette not found." });
  }

  const palette = db
    .prepare("SELECT id, base_hex, shades_json, created_at FROM palettes WHERE id = ? AND user_id = ?")
    .get(paletteId, req.session.user.id);

  if (!palette) {
    return res.status(404).render("error", { title: "Not found", message: "Palette not found." });
  }

  return res.render("index", {
    title: "Palette Generator",
    baseHex: palette.base_hex,
    shades: JSON.parse(palette.shades_json),
    palettes: db
      .prepare("SELECT id, base_hex, shades_json, created_at FROM palettes WHERE user_id = ? ORDER BY id DESC LIMIT 10")
      .all(req.session.user.id)
      .map((row) => ({ ...row, shades: JSON.parse(row.shades_json) })),
    error: null
  });
});

app.get("/register", (req, res) => {
  res.render("auth", { title: "Create account", mode: "register", error: null });
});

app.post("/register", async (req, res, next) => {
  try {
    const username = sanitizeUsername(req.body.username);
    const password = String(req.body.password || "");

    if (!username || !validator.isLength(password, { min: 12, max: 128 })) {
      return res.status(400).render("auth", {
        title: "Create account",
        mode: "register",
        error: "Use a 3-32 character username and a password of at least 12 characters."
      });
    }

    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1
    });

    const info = db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run(username, passwordHash);
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = { id: info.lastInsertRowid, username };
      return res.redirect("/");
    });
  } catch (error) {
    if (error && error.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).render("auth", {
        title: "Create account",
        mode: "register",
        error: "That username is already taken."
      });
    }
    return next(error);
  }
});

app.get("/login", (req, res) => {
  res.render("auth", { title: "Sign in", mode: "login", error: null });
});

app.post("/login", async (req, res, next) => {
  try {
    const username = sanitizeUsername(req.body.username);
    const password = String(req.body.password || "");
    const user = username ? db.prepare("SELECT id, username, password_hash FROM users WHERE username = ?").get(username) : null;

    if (!user || !(await argon2.verify(user.password_hash, password))) {
      return res.status(401).render("auth", {
        title: "Sign in",
        mode: "login",
        error: "Invalid username or password."
      });
    }

    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = { id: user.id, username: user.username };
      return res.redirect("/");
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/logout", requireAuth, (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie("palette.sid");
    return res.redirect("/");
  });
});

app.use((req, res) => {
  res.status(404).render("error", { title: "Not found", message: "The requested page was not found." });
});

app.use((err, req, res, next) => {
  const requestId = crypto.randomUUID();
  console.error(`[${requestId}]`, err);
  res.locals.user = res.locals.user || null;
  res.locals.csrfToken = res.locals.csrfToken || "";

  if (err.code === "EBADCSRFTOKEN") {
    return res.status(403).render("error", {
      title: "Request rejected",
      message: "The form expired or was invalid. Please go back and try again."
    });
  }

  return res.status(500).render("error", {
    title: "Server error",
    message: `Something went wrong. Reference: ${requestId}`
  });
});

app.listen(PORT, () => {
  console.log(`Palette app listening on port ${PORT}`);
});
