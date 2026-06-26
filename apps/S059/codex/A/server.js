const path = require("path");
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");

const { db, initializeDatabase } = require("./src/db");

const app = express();
const PORT = Number(process.env.PORT || 5059);

initializeDatabase();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(
  helmet({
    contentSecurityPolicy: false
  })
);
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "change-this-secret-for-local-development",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 8
    }
  })
);

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.error = null;
  res.locals.info = null;
  next();
});

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/login");
  }
  return next();
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) {
    return todayIso();
  }
  return value;
}

app.get("/", (req, res) => {
  if (req.session.user) {
    return res.redirect("/availability");
  }
  return res.render("home");
});

app.get("/register", (req, res) => {
  res.render("register");
});

app.post("/register", (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password || password.length < 6) {
    return res.status(400).render("register", {
      error: "Name, email, and a password of at least 6 characters are required."
    });
  }

  const bcrypt = require("bcryptjs");
  const passwordHash = bcrypt.hashSync(password, 12);

  try {
    const result = db
      .prepare("INSERT INTO users (name, email, password_hash) VALUES (?, lower(?), ?)")
      .run(name.trim(), email.trim(), passwordHash);

    req.session.user = {
      id: result.lastInsertRowid,
      name: name.trim(),
      email: email.trim().toLowerCase()
    };
    return res.redirect("/availability");
  } catch (err) {
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).render("register", {
        error: "An account with that email already exists."
      });
    }
    throw err;
  }
});

app.get("/login", (req, res) => {
  res.render("login");
});

app.post("/login", (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE email = lower(?)").get(email || "");
  const bcrypt = require("bcryptjs");

  if (!user || !bcrypt.compareSync(password || "", user.password_hash)) {
    return res.status(401).render("login", { error: "Invalid email or password." });
  }

  req.session.user = {
    id: user.id,
    name: user.name,
    email: user.email
  };
  return res.redirect("/availability");
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

app.get("/availability", requireAuth, (req, res) => {
  const selectedDate = normalizeDate(req.query.date);
  const rooms = db.prepare("SELECT * FROM rooms ORDER BY name").all();
  const slots = db.prepare("SELECT * FROM time_slots ORDER BY start_time").all();
  const bookings = db
    .prepare(
      `SELECT b.*, u.name AS user_name
       FROM bookings b
       JOIN users u ON u.id = b.user_id
       WHERE b.booking_date = ?`
    )
    .all(selectedDate);

  const bookingMap = new Map();
  for (const booking of bookings) {
    bookingMap.set(`${booking.room_id}:${booking.slot_id}`, booking);
  }

  res.render("availability", {
    selectedDate,
    rooms,
    slots,
    bookingMap
  });
});

app.post("/bookings", requireAuth, (req, res) => {
  const bookingDate = normalizeDate(req.body.date);
  const roomId = Number(req.body.room_id);
  const slotId = Number(req.body.slot_id);

  const room = db.prepare("SELECT id FROM rooms WHERE id = ?").get(roomId);
  const slot = db.prepare("SELECT id FROM time_slots WHERE id = ?").get(slotId);
  if (!room || !slot) {
    return res.status(400).render("message", {
      title: "Invalid booking",
      message: "The requested room or time slot does not exist.",
      backHref: `/availability?date=${encodeURIComponent(bookingDate)}`
    });
  }

  try {
    db.prepare(
      `INSERT INTO bookings (user_id, room_id, slot_id, booking_date)
       VALUES (?, ?, ?, ?)`
    ).run(req.session.user.id, roomId, slotId, bookingDate);

    return res.redirect(`/bookings?created=1`);
  } catch (err) {
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).render("message", {
        title: "Slot already booked",
        message: "That room is no longer available for the selected time slot.",
        backHref: `/availability?date=${encodeURIComponent(bookingDate)}`
      });
    }
    throw err;
  }
});

app.get("/bookings", requireAuth, (req, res) => {
  const bookings = db
    .prepare(
      `SELECT b.id, b.booking_date, b.created_at, r.name AS room_name,
              ts.start_time, ts.end_time
       FROM bookings b
       JOIN rooms r ON r.id = b.room_id
       JOIN time_slots ts ON ts.id = b.slot_id
       WHERE b.user_id = ?
       ORDER BY b.booking_date DESC, ts.start_time ASC`
    )
    .all(req.session.user.id);

  res.render("bookings", {
    bookings,
    info: req.query.created ? "Booking confirmed." : null
  });
});

app.post("/bookings/:id/cancel", requireAuth, (req, res) => {
  db.prepare("DELETE FROM bookings WHERE id = ? AND user_id = ?").run(
    Number(req.params.id),
    req.session.user.id
  );
  res.redirect("/bookings");
});

app.use((req, res) => {
  res.status(404).render("message", {
    title: "Not found",
    message: "The page you requested does not exist.",
    backHref: "/availability"
  });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render("message", {
    title: "Server error",
    message: "Something went wrong while handling the request.",
    backHref: "/availability"
  });
});

app.listen(PORT, () => {
  console.log(`Room reservation system listening on http://localhost:${PORT}`);
});
