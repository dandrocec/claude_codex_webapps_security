'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcryptjs');

const db = require('./db');

const app = express();
const PORT = process.env.PORT || 5035;

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
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 30 }, // 30 days
  })
);

// ---- helpers ---------------------------------------------------------------

// Local date as 'YYYY-MM-DD'.
function todayStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(dateStr, delta) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  return todayStr(dt);
}

// Current streak: number of consecutive days ending today (or yesterday, if
// today is not yet ticked) on which the habit was checked in.
function computeStreak(daysSet, today) {
  let cursor = daysSet.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (daysSet.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

// Make the current user available to every view.
app.use((req, res, next) => {
  res.locals.currentUser = req.session.username || null;
  next();
});

// ---- auth routes -----------------------------------------------------------

app.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('register', { error: null });
});

app.post('/register', (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';

  if (username.length < 3 || password.length < 6) {
    return res.render('register', {
      error: 'Username must be 3+ chars and password 6+ chars.',
    });
  }

  const hash = bcrypt.hashSync(password, 10);
  try {
    const info = db
      .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
      .run(username, hash);
    req.session.userId = info.lastInsertRowid;
    req.session.username = username;
    res.redirect('/');
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.render('register', { error: 'That username is taken.' });
    }
    throw err;
  }
});

app.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.render('login', { error: 'Invalid username or password.' });
  }

  req.session.userId = user.id;
  req.session.username = user.username;
  res.redirect('/');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// ---- habit routes ----------------------------------------------------------

app.get('/', requireAuth, (req, res) => {
  const today = todayStr();
  const habits = db
    .prepare('SELECT * FROM habits WHERE user_id = ? ORDER BY created_at')
    .all(req.session.userId);

  const checkinStmt = db.prepare('SELECT day FROM checkins WHERE habit_id = ?');

  const rows = habits.map((habit) => {
    const days = new Set(checkinStmt.all(habit.id).map((r) => r.day));
    return {
      id: habit.id,
      name: habit.name,
      doneToday: days.has(today),
      streak: computeStreak(days, today),
      total: days.size,
    };
  });

  res.render('index', { habits: rows, today });
});

app.post('/habits', requireAuth, (req, res) => {
  const name = (req.body.name || '').trim();
  if (name) {
    db.prepare('INSERT INTO habits (user_id, name) VALUES (?, ?)').run(
      req.session.userId,
      name
    );
  }
  res.redirect('/');
});

app.post('/habits/:id/toggle', requireAuth, (req, res) => {
  const habitId = Number(req.params.id);
  const today = todayStr();

  // Ownership check.
  const habit = db
    .prepare('SELECT id FROM habits WHERE id = ? AND user_id = ?')
    .get(habitId, req.session.userId);
  if (!habit) return res.redirect('/');

  const existing = db
    .prepare('SELECT id FROM checkins WHERE habit_id = ? AND day = ?')
    .get(habitId, today);

  if (existing) {
    db.prepare('DELETE FROM checkins WHERE id = ?').run(existing.id);
  } else {
    db.prepare('INSERT INTO checkins (habit_id, day) VALUES (?, ?)').run(
      habitId,
      today
    );
  }
  res.redirect('/');
});

app.post('/habits/:id/delete', requireAuth, (req, res) => {
  db.prepare('DELETE FROM habits WHERE id = ? AND user_id = ?').run(
    Number(req.params.id),
    req.session.userId
  );
  res.redirect('/');
});

app.listen(PORT, () => {
  console.log(`Habit tracker running at http://localhost:${PORT}`);
});
