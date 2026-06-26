require("dotenv").config();

const path = require("path");
const crypto = require("crypto");
const fs = require("fs");
const express = require("express");
const session = require("express-session");
const SQLiteStoreFactory = require("connect-sqlite3");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcrypt");
const { body, param, query, validationResult } = require("express-validator");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");

const PORT = Number.parseInt(process.env.PORT || "5059", 10);
const SESSION_SECRET = process.env.SESSION_SECRET;
const DATABASE_FILE = process.env.DATABASE_FILE || path.join(__dirname, "..", "data", "reservations.sqlite");
const COOKIE_SECURE = process.env.COOKIE_SECURE === "true" || process.env.NODE_ENV === "production";
const TIME_SLOTS = [
  ["09:00", "10:00"],
  ["10:00", "11:00"],
  ["11:00", "12:00"],
  ["13:00", "14:00"],
  ["14:00", "15:00"],
  ["15:00", "16:00"],
  ["16:00", "17:00"]
];

if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  throw new Error("SESSION_SECRET must be set to at least 32 characters.");
}

fs.mkdirSync(path.dirname(DATABASE_FILE), { recursive: true });

const app = express();
const SQLiteStore = SQLiteStoreFactory(session);

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
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public"), { index: false }));
app.use(session({
  name: "reservation.sid",
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: new SQLiteStore({
    db: "sessions.sqlite",
    dir: path.dirname(DATABASE_FILE)
  }),
  cookie: {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 2
  }
}));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false
}));

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.csrfToken = getCsrfToken(req);
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
});

let db;

function flash(req, type, message) {
  req.session.flash = { type, message };
}

function getCsrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString("base64url");
  }
  return req.session.csrfToken;
}

function validateCsrf(req, res, next) {
  const sentToken = String(req.body._csrf || "");
  const sessionToken = String(req.session.csrfToken || "");
  const sent = Buffer.from(sentToken);
  const expected = Buffer.from(sessionToken);

  if (sent.length === 0 || sent.length !== expected.length || !crypto.timingSafeEqual(sent, expected)) {
    return res.status(403).render("error", { title: "Request rejected", message: "Invalid or expired CSRF token." });
  }
  return next();
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    flash(req, "error", "Please sign in first.");
    return res.redirect("/login");
  }
  return next();
}

function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    flash(req, "error", errors.array()[0].msg);
    return res.redirect(req.get("Referrer") || "/");
  }
  return next();
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isValidSlot(start, end) {
  return TIME_SLOTS.some(([slotStart, slotEnd]) => slotStart === start && slotEnd === end);
}

async function initDb() {
  db = await open({ filename: DATABASE_FILE, driver: sqlite3.Database });
  await db.exec("PRAGMA foreign_keys = ON;");
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      capacity INTEGER NOT NULL CHECK (capacity > 0)
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      room_id INTEGER NOT NULL,
      booking_date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      UNIQUE (room_id, booking_date, start_time, end_time)
    );
  `);

  const roomCount = await db.get("SELECT COUNT(*) AS count FROM rooms");
  if (roomCount.count === 0) {
    const rooms = [
      ["Oak Conference Room", 8],
      ["Maple Focus Room", 4],
      ["Cedar Workshop Room", 16],
      ["Birch Interview Room", 3]
    ];
    for (const [name, capacity] of rooms) {
      await db.run("INSERT INTO rooms (name, capacity) VALUES (?, ?)", name, capacity);
    }
  }
}

app.get("/", (req, res) => {
  if (req.session.user) return res.redirect("/availability");
  return res.redirect("/login");
});

app.get("/register", (req, res) => {
  res.render("auth", { title: "Create account", action: "/register", submitLabel: "Create account" });
});

app.post(
  "/register",
  validateCsrf,
  body("email").trim().isEmail().withMessage("Enter a valid email address.").normalizeEmail().isLength({ max: 254 }),
  body("password").isLength({ min: 12, max: 128 }).withMessage("Password must be 12 to 128 characters."),
  handleValidation,
  async (req, res, next) => {
    try {
      const email = req.body.email;
      const passwordHash = await bcrypt.hash(req.body.password, 12);
      await db.run("INSERT INTO users (email, password_hash) VALUES (?, ?)", email, passwordHash);
      flash(req, "success", "Account created. Please sign in.");
      return res.redirect("/login");
    } catch (err) {
      if (err && err.code === "SQLITE_CONSTRAINT") {
        flash(req, "error", "An account with that email already exists.");
        return res.redirect("/register");
      }
      return next(err);
    }
  }
);

app.get("/login", (req, res) => {
  res.render("auth", { title: "Sign in", action: "/login", submitLabel: "Sign in" });
});

app.post(
  "/login",
  validateCsrf,
  body("email").trim().isEmail().withMessage("Enter a valid email address.").normalizeEmail().isLength({ max: 254 }),
  body("password").isLength({ min: 1, max: 128 }).withMessage("Enter your password."),
  handleValidation,
  async (req, res, next) => {
    try {
      const user = await db.get("SELECT id, email, password_hash FROM users WHERE email = ?", req.body.email);
      const ok = user ? await bcrypt.compare(req.body.password, user.password_hash) : false;
      if (!ok) {
        flash(req, "error", "Invalid email or password.");
        return res.redirect("/login");
      }

      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.user = { id: user.id, email: user.email };
        req.session.csrfToken = crypto.randomBytes(32).toString("base64url");
        return res.redirect("/availability");
      });
    } catch (err) {
      return next(err);
    }
  }
);

app.post("/logout", validateCsrf, requireAuth, (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie("reservation.sid");
    return res.redirect("/login");
  });
});

app.get(
  "/availability",
  requireAuth,
  query("date").optional().custom(isValidDate).withMessage("Choose a valid date."),
  handleValidation,
  async (req, res, next) => {
    try {
      const selectedDate = req.query.date || new Date().toISOString().slice(0, 10);
      const rooms = await db.all("SELECT id, name, capacity FROM rooms ORDER BY name ASC");
      const bookings = await db.all(
        `SELECT b.id, b.room_id, b.start_time, b.end_time, u.email
         FROM bookings b
         JOIN users u ON u.id = b.user_id
         WHERE b.booking_date = ?`,
        selectedDate
      );

      const booked = new Map();
      for (const booking of bookings) {
        booked.set(`${booking.room_id}:${booking.start_time}:${booking.end_time}`, booking);
      }

      res.render("availability", { title: "Availability", selectedDate, rooms, timeSlots: TIME_SLOTS, booked });
    } catch (err) {
      return next(err);
    }
  }
);

app.post(
  "/bookings",
  validateCsrf,
  requireAuth,
  body("room_id").isInt({ min: 1 }).withMessage("Choose a room."),
  body("booking_date").custom(isValidDate).withMessage("Choose a valid date."),
  body("start_time").matches(/^\d{2}:\d{2}$/).withMessage("Choose a valid start time."),
  body("end_time").matches(/^\d{2}:\d{2}$/).withMessage("Choose a valid end time."),
  handleValidation,
  async (req, res, next) => {
    const roomId = Number.parseInt(req.body.room_id, 10);
    const bookingDate = req.body.booking_date;
    const startTime = req.body.start_time;
    const endTime = req.body.end_time;

    if (!isValidSlot(startTime, endTime)) {
      flash(req, "error", "Choose one of the available time slots.");
      return res.redirect(`/availability?date=${encodeURIComponent(bookingDate)}`);
    }

    try {
      const room = await db.get("SELECT id FROM rooms WHERE id = ?", roomId);
      if (!room) {
        flash(req, "error", "Room not found.");
        return res.redirect(`/availability?date=${encodeURIComponent(bookingDate)}`);
      }

      await db.run(
        "INSERT INTO bookings (user_id, room_id, booking_date, start_time, end_time) VALUES (?, ?, ?, ?, ?)",
        req.session.user.id,
        roomId,
        bookingDate,
        startTime,
        endTime
      );
      flash(req, "success", "Room booked.");
      return res.redirect(`/availability?date=${encodeURIComponent(bookingDate)}`);
    } catch (err) {
      if (err && err.code === "SQLITE_CONSTRAINT") {
        flash(req, "error", "That room is already booked for the selected slot.");
        return res.redirect(`/availability?date=${encodeURIComponent(bookingDate)}`);
      }
      return next(err);
    }
  }
);

app.get("/bookings", requireAuth, async (req, res, next) => {
  try {
    const bookings = await db.all(
      `SELECT b.id, b.booking_date, b.start_time, b.end_time, r.name AS room_name, r.capacity
       FROM bookings b
       JOIN rooms r ON r.id = b.room_id
       WHERE b.user_id = ?
       ORDER BY b.booking_date ASC, b.start_time ASC`,
      req.session.user.id
    );
    res.render("bookings", { title: "My bookings", bookings });
  } catch (err) {
    return next(err);
  }
});

app.post(
  "/bookings/:id/cancel",
  validateCsrf,
  requireAuth,
  param("id").isInt({ min: 1 }).withMessage("Invalid booking."),
  handleValidation,
  async (req, res, next) => {
    try {
      const result = await db.run(
        "DELETE FROM bookings WHERE id = ? AND user_id = ?",
        Number.parseInt(req.params.id, 10),
        req.session.user.id
      );
      flash(req, result.changes === 1 ? "success" : "error", result.changes === 1 ? "Booking cancelled." : "Booking not found.");
      return res.redirect("/bookings");
    } catch (err) {
      return next(err);
    }
  }
);

app.use((req, res) => {
  res.status(404).render("error", { title: "Not found", message: "The requested page was not found." });
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  return res.status(500).render("error", { title: "Server error", message: "Something went wrong. Please try again." });
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Reservation system listening on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to start application", err);
    process.exit(1);
  });
