'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcryptjs');

const db = require('./db');

const app = express();
const PORT = process.env.PORT || 5059;

// Fixed set of bookable time slots for every room, every day.
const SLOTS = [
  '08:00-09:00',
  '09:00-10:00',
  '10:00-11:00',
  '11:00-12:00',
  '12:00-13:00',
  '13:00-14:00',
  '14:00-15:00',
  '15:00-16:00',
  '16:00-17:00',
];

// ---------------------------------------------------------------------------
// App configuration
// ---------------------------------------------------------------------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    store: new SQLiteStore({ db: 'sessions.sqlite', dir: __dirname }),
    secret: process.env.SESSION_SECRET || 'change-me-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 8 }, // 8 hours
  })
);

// Make the current user available to every template.
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Basic validation: YYYY-MM-DD and a known slot.
function isValidDate(d) {
  return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
}

// ---------------------------------------------------------------------------
// Prepared statements
// ---------------------------------------------------------------------------
const stmts = {
  userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
  createUser: db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)'),
  allRooms: db.prepare('SELECT * FROM rooms ORDER BY name'),
  roomById: db.prepare('SELECT * FROM rooms WHERE id = ?'),
  bookingsOnDate: db.prepare('SELECT * FROM bookings WHERE date = ?'),
  insertBooking: db.prepare(
    'INSERT INTO bookings (room_id, user_id, date, slot) VALUES (?, ?, ?, ?)'
  ),
  bookingsByUser: db.prepare(`
    SELECT b.*, r.name AS room_name
    FROM bookings b
    JOIN rooms r ON r.id = b.room_id
    WHERE b.user_id = ?
    ORDER BY b.date, b.slot
  `),
  bookingById: db.prepare('SELECT * FROM bookings WHERE id = ?'),
  deleteBooking: db.prepare('DELETE FROM bookings WHERE id = ? AND user_id = ?'),
};

// ---------------------------------------------------------------------------
// Auth routes
// ---------------------------------------------------------------------------
app.get('/', (req, res) => {
  res.redirect(req.session.user ? '/availability' : '/login');
});

app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/availability');
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = stmts.userByName.get((username || '').trim());
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).render('login', { error: 'Invalid username or password.' });
  }
  req.session.user = { id: user.id, username: user.username };
  res.redirect('/availability');
});

app.get('/register', (req, res) => {
  if (req.session.user) return res.redirect('/availability');
  res.render('register', { error: null });
});

app.post('/register', (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';
  if (username.length < 3 || password.length < 6) {
    return res.status(400).render('register', {
      error: 'Username must be ≥ 3 chars and password ≥ 6 chars.',
    });
  }
  if (stmts.userByName.get(username)) {
    return res.status(409).render('register', { error: 'That username is already taken.' });
  }
  const info = stmts.createUser.run(username, bcrypt.hashSync(password, 10));
  req.session.user = { id: info.lastInsertRowid, username };
  res.redirect('/availability');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// ---------------------------------------------------------------------------
// Availability + booking
// ---------------------------------------------------------------------------
app.get('/availability', requireLogin, (req, res) => {
  const date = isValidDate(req.query.date) ? req.query.date : todayISO();
  const rooms = stmts.allRooms.all();
  const booked = stmts.bookingsOnDate.all(date);

  // Map "roomId|slot" -> booking, so the view can show free/taken quickly.
  const takenBy = new Map();
  for (const b of booked) takenBy.set(`${b.room_id}|${b.slot}`, b);

  const grid = rooms.map((room) => ({
    room,
    slots: SLOTS.map((slot) => {
      const b = takenBy.get(`${room.id}|${slot}`);
      return {
        slot,
        taken: Boolean(b),
        mine: b ? b.user_id === req.session.user.id : false,
      };
    }),
  }));

  res.render('availability', {
    date,
    grid,
    slots: SLOTS,
    flash: req.session.flash || null,
  });
  req.session.flash = null;
});

app.post('/book', requireLogin, (req, res) => {
  const { room_id, slot, date } = req.body;
  const roomId = Number(room_id);

  if (!isValidDate(date) || !SLOTS.includes(slot) || !stmts.roomById.get(roomId)) {
    req.session.flash = { type: 'error', msg: 'Invalid booking request.' };
    return res.redirect('/availability?date=' + encodeURIComponent(date || todayISO()));
  }

  try {
    stmts.insertBooking.run(roomId, req.session.user.id, date, slot);
    req.session.flash = { type: 'success', msg: `Booked ${slot} on ${date}.` };
  } catch (err) {
    // The UNIQUE(room_id, date, slot) constraint rejects double-bookings.
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      req.session.flash = { type: 'error', msg: 'That slot was just taken. Please pick another.' };
    } else {
      throw err;
    }
  }
  res.redirect('/availability?date=' + encodeURIComponent(date));
});

// ---------------------------------------------------------------------------
// My bookings
// ---------------------------------------------------------------------------
app.get('/bookings', requireLogin, (req, res) => {
  const bookings = stmts.bookingsByUser.all(req.session.user.id);
  res.render('bookings', { bookings, flash: req.session.flash || null });
  req.session.flash = null;
});

app.post('/bookings/:id/cancel', requireLogin, (req, res) => {
  // The WHERE user_id = ? guarantees a user can only cancel their own booking.
  const info = stmts.deleteBooking.run(Number(req.params.id), req.session.user.id);
  req.session.flash =
    info.changes > 0
      ? { type: 'success', msg: 'Booking cancelled.' }
      : { type: 'error', msg: 'Booking not found.' };
  res.redirect('/bookings');
});

// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Room reservation system running at http://localhost:${PORT}`);
});
