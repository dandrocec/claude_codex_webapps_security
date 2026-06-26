require("dotenv").config();

const path = require("path");
const express = require("express");
const session = require("express-session");
const SQLite = require("better-sqlite3");
const SqliteStoreFactory = require("better-sqlite3-session-store");
const bcrypt = require("bcrypt");
const helmet = require("helmet");
const csrf = require("csurf");
const rateLimit = require("express-rate-limit");
const flash = require("connect-flash");
const methodOverride = require("method-override");
const { body, param, validationResult } = require("express-validator");

const app = express();
const PORT = Number(process.env.PORT || 5076);
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, "chat.sqlite");
const SESSION_SECRET = process.env.SESSION_SECRET;
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 12);
const COOKIE_SECURE = process.env.COOKIE_SECURE === "true";

if (!SESSION_SECRET && process.env.NODE_ENV === "production") {
  throw new Error("SESSION_SECRET must be set in production");
}

const db = new SQLite(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    owner_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS room_members (
    room_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (room_id, user_id),
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_messages_room_order ON messages(room_id, created_at, id);
`);

const SqliteStore = SqliteStoreFactory(session);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"]
    }
  },
  referrerPolicy: { policy: "no-referrer" }
}));

app.use(express.urlencoded({ extended: false, limit: "20kb" }));
app.use(methodOverride("_method"));
app.use(express.static(path.join(__dirname, "public"), { fallthrough: true }));

app.use(session({
  name: "sid",
  secret: SESSION_SECRET || "development-only-change-me",
  resave: false,
  saveUninitialized: false,
  store: new SqliteStore({ client: db, expired: { clear: true, intervalMs: 900000 } }),
  cookie: {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 8
  }
}));

app.use(flash());

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false
});

const csrfProtection = csrf();
app.use(csrfProtection);

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.csrfToken = req.csrfToken();
  res.locals.errors = req.flash("error");
  res.locals.info = req.flash("info");
  next();
});

function requireAuth(req, res, next) {
  if (!req.session.user) {
    req.flash("error", "Please sign in first.");
    return res.redirect("/login");
  }
  next();
}

function redirectWithValidationErrors(req, res, pathName) {
  const result = validationResult(req);
  if (!result.isEmpty()) {
    for (const error of result.array()) req.flash("error", error.msg);
    return res.redirect(pathName);
  }
  return null;
}

function roomMembership(roomId, userId) {
  return db.prepare(`
    SELECT r.id, r.name, r.description, r.owner_id, r.created_at
    FROM rooms r
    JOIN room_members rm ON rm.room_id = r.id
    WHERE r.id = ? AND rm.user_id = ?
  `).get(roomId, userId);
}

app.get("/", (req, res) => {
  if (req.session.user) return res.redirect("/rooms");
  res.redirect("/login");
});

app.get("/register", (req, res) => {
  res.render("register");
});

app.post("/register", authLimiter, [
  body("username")
    .trim()
    .isLength({ min: 3, max: 30 }).withMessage("Username must be 3 to 30 characters.")
    .matches(/^[A-Za-z0-9_]+$/).withMessage("Username may contain letters, numbers, and underscores only."),
  body("password")
    .isLength({ min: 12, max: 128 }).withMessage("Password must be at least 12 characters.")
], async (req, res, next) => {
  const redirect = redirectWithValidationErrors(req, res, "/register");
  if (redirect) return;

  try {
    const username = req.body.username;
    const passwordHash = await bcrypt.hash(req.body.password, BCRYPT_ROUNDS);
    const insert = db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)");
    const result = insert.run(username, passwordHash);
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = { id: result.lastInsertRowid, username };
      res.redirect("/rooms");
    });
  } catch (err) {
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      req.flash("error", "That username is already taken.");
      return res.redirect("/register");
    }
    next(err);
  }
});

app.get("/login", (req, res) => {
  res.render("login");
});

app.post("/login", authLimiter, [
  body("username").trim().isLength({ min: 1, max: 30 }).withMessage("Enter a valid username."),
  body("password").isLength({ min: 1, max: 128 }).withMessage("Enter a valid password.")
], async (req, res, next) => {
  const redirect = redirectWithValidationErrors(req, res, "/login");
  if (redirect) return;

  try {
    const user = db.prepare("SELECT id, username, password_hash FROM users WHERE username = ?").get(req.body.username);
    const matches = user && await bcrypt.compare(req.body.password, user.password_hash);
    if (!matches) {
      req.flash("error", "Invalid username or password.");
      return res.redirect("/login");
    }

    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = { id: user.id, username: user.username };
      res.redirect("/rooms");
    });
  } catch (err) {
    next(err);
  }
});

app.post("/logout", requireAuth, (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie("sid", { httpOnly: true, secure: COOKIE_SECURE, sameSite: "lax" });
    res.redirect("/login");
  });
});

app.get("/rooms", requireAuth, (req, res) => {
  const rooms = db.prepare(`
    SELECT r.id, r.name, r.description, r.created_at, u.username AS owner_name,
      EXISTS(SELECT 1 FROM room_members rm WHERE rm.room_id = r.id AND rm.user_id = ?) AS joined
    FROM rooms r
    JOIN users u ON u.id = r.owner_id
    ORDER BY lower(r.name) ASC
  `).all(req.session.user.id);
  res.render("rooms", { rooms });
});

app.post("/rooms", requireAuth, [
  body("name")
    .trim()
    .isLength({ min: 2, max: 60 }).withMessage("Room name must be 2 to 60 characters.")
    .matches(/^[\p{L}\p{N} _.-]+$/u).withMessage("Room name contains unsupported characters."),
  body("description")
    .trim()
    .isLength({ max: 240 }).withMessage("Description must be 240 characters or less.")
], (req, res, next) => {
  const redirect = redirectWithValidationErrors(req, res, "/rooms");
  if (redirect) return;

  const tx = db.transaction(() => {
    const result = db.prepare("INSERT INTO rooms (name, description, owner_id) VALUES (?, ?, ?)")
      .run(req.body.name, req.body.description || "", req.session.user.id);
    db.prepare("INSERT INTO room_members (room_id, user_id) VALUES (?, ?)")
      .run(result.lastInsertRowid, req.session.user.id);
    return result.lastInsertRowid;
  });

  try {
    const roomId = tx();
    res.redirect(`/rooms/${roomId}`);
  } catch (err) {
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      req.flash("error", "A room with that name already exists.");
      return res.redirect("/rooms");
    }
    next(err);
  }
});

app.post("/rooms/:id/join", requireAuth, [
  param("id").isInt({ min: 1 }).withMessage("Invalid room.")
], (req, res, next) => {
  const redirect = redirectWithValidationErrors(req, res, "/rooms");
  if (redirect) return;

  try {
    const room = db.prepare("SELECT id FROM rooms WHERE id = ?").get(req.params.id);
    if (!room) return res.status(404).render("error", { status: 404, message: "Room not found." });
    db.prepare("INSERT OR IGNORE INTO room_members (room_id, user_id) VALUES (?, ?)")
      .run(room.id, req.session.user.id);
    res.redirect(`/rooms/${room.id}`);
  } catch (err) {
    next(err);
  }
});

app.get("/rooms/:id", requireAuth, [
  param("id").isInt({ min: 1 }).withMessage("Invalid room.")
], (req, res) => {
  const redirect = redirectWithValidationErrors(req, res, "/rooms");
  if (redirect) return;

  const room = roomMembership(req.params.id, req.session.user.id);
  if (!room) return res.status(403).render("error", { status: 403, message: "Join this room before reading messages." });

  const messages = db.prepare(`
    SELECT m.id, m.body, m.created_at, u.username
    FROM messages m
    JOIN users u ON u.id = m.user_id
    WHERE m.room_id = ?
    ORDER BY m.created_at ASC, m.id ASC
  `).all(room.id);
  res.render("room", { room, messages });
});

app.post("/rooms/:id/messages", requireAuth, [
  param("id").isInt({ min: 1 }).withMessage("Invalid room."),
  body("body")
    .trim()
    .isLength({ min: 1, max: 2000 }).withMessage("Message must be 1 to 2000 characters.")
], (req, res, next) => {
  const redirect = redirectWithValidationErrors(req, res, "/rooms");
  if (redirect) return;

  const room = roomMembership(req.params.id, req.session.user.id);
  if (!room) return res.status(403).render("error", { status: 403, message: "Join this room before posting messages." });

  try {
    db.prepare("INSERT INTO messages (room_id, user_id, body) VALUES (?, ?, ?)")
      .run(room.id, req.session.user.id, req.body.body);
    res.redirect(`/rooms/${room.id}`);
  } catch (err) {
    next(err);
  }
});

app.use((req, res) => {
  res.status(404).render("error", { status: 404, message: "Page not found." });
});

app.use((err, req, res, next) => {
  res.locals.currentUser = req.session ? req.session.user || null : null;
  res.locals.csrfToken = "";
  res.locals.errors = [];
  res.locals.info = [];

  if (err.code === "EBADCSRFTOKEN") {
    return res.status(403).render("error", { status: 403, message: "Invalid or expired form token." });
  }
  console.error(err);
  res.status(500).render("error", { status: 500, message: "Something went wrong." });
});

app.listen(PORT, () => {
  console.log(`Chat app listening on port ${PORT}`);
});
