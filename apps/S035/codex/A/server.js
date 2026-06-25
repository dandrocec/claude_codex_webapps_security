const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5035;
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = process.env.DATABASE_URL || path.join(DATA_DIR, 'habits.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS habits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    archived_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS completions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    habit_id INTEGER NOT NULL,
    completed_on TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (habit_id, completed_on),
    FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE
  );
`);

app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(
  session({
    name: 'habit.sid',
    secret: process.env.SESSION_SECRET || 'dev-only-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 14
    }
  })
);

function todayIso() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.redirect('/login');
  }
  next();
}

function getCurrentUser(req) {
  if (!req.session.userId) return null;
  return db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.session.userId);
}

function flash(req, message) {
  req.session.flash = message;
}

function consumeFlash(req) {
  const message = req.session.flash;
  delete req.session.flash;
  return message;
}

function layout({ title, user, flashMessage, body }) {
  const nav = user
    ? `
      <nav class="top-nav">
        <a class="brand" href="/">Habit Tracker</a>
        <div class="nav-actions">
          <span>${escapeHtml(user.username)}</span>
          <form method="post" action="/logout">
            <button type="submit" class="link-button">Log out</button>
          </form>
        </div>
      </nav>`
    : `
      <nav class="top-nav">
        <a class="brand" href="/">Habit Tracker</a>
        <div class="nav-actions">
          <a href="/login">Log in</a>
          <a href="/register">Register</a>
        </div>
      </nav>`;

  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>${escapeHtml(title)}</title>
      <link rel="stylesheet" href="/styles.css">
    </head>
    <body>
      ${nav}
      <main class="page">
        ${flashMessage ? `<div class="flash">${escapeHtml(flashMessage)}</div>` : ''}
        ${body}
      </main>
    </body>
  </html>`;
}

function authPage(req, res, mode) {
  const isRegister = mode === 'register';
  const user = getCurrentUser(req);
  const action = isRegister ? '/register' : '/login';
  const title = isRegister ? 'Create account' : 'Log in';
  const alternate = isRegister
    ? 'Already have an account? <a href="/login">Log in</a>.'
    : 'Need an account? <a href="/register">Register</a>.';

  res.send(
    layout({
      title,
      user,
      flashMessage: consumeFlash(req),
      body: `
        <section class="auth-panel">
          <h1>${title}</h1>
          <form method="post" action="${action}" class="form-stack">
            <label>
              Username
              <input name="username" type="text" autocomplete="username" minlength="3" maxlength="32" required>
            </label>
            <label>
              Password
              <input name="password" type="password" autocomplete="${isRegister ? 'new-password' : 'current-password'}" minlength="6" required>
            </label>
            <button type="submit" class="primary-button">${title}</button>
          </form>
          <p class="muted">${alternate}</p>
        </section>`
    })
  );
}

function calculateStreak(habitId, today) {
  const rows = db
    .prepare('SELECT completed_on FROM completions WHERE habit_id = ? ORDER BY completed_on DESC')
    .all(habitId);
  const completed = new Set(rows.map((row) => row.completed_on));

  let cursor = completed.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (completed.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

app.get('/', requireAuth, (req, res) => {
  const user = getCurrentUser(req);
  const today = todayIso();
  const habits = db
    .prepare(
      `SELECT h.id, h.name,
        EXISTS (
          SELECT 1 FROM completions c
          WHERE c.habit_id = h.id AND c.completed_on = ?
        ) AS done_today
       FROM habits h
       WHERE h.user_id = ? AND h.archived_at IS NULL
       ORDER BY h.created_at ASC, h.id ASC`
    )
    .all(today, user.id)
    .map((habit) => ({
      ...habit,
      streak: calculateStreak(habit.id, today)
    }));

  const habitItems = habits.length
    ? habits
        .map(
          (habit) => `
          <article class="habit-card">
            <div>
              <h2>${escapeHtml(habit.name)}</h2>
              <p class="streak">${habit.streak} day${habit.streak === 1 ? '' : 's'} streak</p>
            </div>
            <div class="habit-actions">
              <form method="post" action="/habits/${habit.id}/toggle">
                <button class="${habit.done_today ? 'done-button' : 'primary-button'}" type="submit">
                  ${habit.done_today ? 'Ticked today' : 'Tick off today'}
                </button>
              </form>
              <form method="post" action="/habits/${habit.id}/delete" onsubmit="return confirm('Delete this habit and its history?');">
                <button class="danger-button" type="submit">Delete</button>
              </form>
            </div>
          </article>`
        )
        .join('')
    : '<p class="empty">No habits yet. Add one to start tracking today.</p>';

  res.send(
    layout({
      title: 'Your habits',
      user,
      flashMessage: consumeFlash(req),
      body: `
        <section class="dashboard-header">
          <div>
            <h1>Today</h1>
            <p>${escapeHtml(today)}</p>
          </div>
          <form method="post" action="/habits" class="new-habit-form">
            <input name="name" type="text" placeholder="New daily habit" maxlength="80" required>
            <button type="submit" class="primary-button">Add habit</button>
          </form>
        </section>
        <section class="habit-list">
          ${habitItems}
        </section>`
    })
  );
});

app.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  authPage(req, res, 'login');
});

app.post('/login', (req, res) => {
  const username = normalizeUsername(req.body.username);
  const password = String(req.body.password || '');
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    flash(req, 'Invalid username or password.');
    return res.redirect('/login');
  }

  req.session.userId = user.id;
  res.redirect('/');
});

app.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  authPage(req, res, 'register');
});

app.post('/register', (req, res) => {
  const username = normalizeUsername(req.body.username);
  const password = String(req.body.password || '');

  if (!/^[a-z0-9_-]{3,32}$/.test(username)) {
    flash(req, 'Use 3-32 letters, numbers, underscores, or hyphens for the username.');
    return res.redirect('/register');
  }

  if (password.length < 6) {
    flash(req, 'Password must be at least 6 characters.');
    return res.redirect('/register');
  }

  try {
    const result = db
      .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
      .run(username, bcrypt.hashSync(password, 12));
    req.session.userId = result.lastInsertRowid;
    res.redirect('/');
  } catch (error) {
    flash(req, 'That username is already taken.');
    res.redirect('/register');
  }
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

app.post('/habits', requireAuth, (req, res) => {
  const user = getCurrentUser(req);
  const name = String(req.body.name || '').trim();

  if (!name || name.length > 80) {
    flash(req, 'Habit name must be between 1 and 80 characters.');
    return res.redirect('/');
  }

  db.prepare('INSERT INTO habits (user_id, name) VALUES (?, ?)').run(user.id, name);
  res.redirect('/');
});

app.post('/habits/:id/toggle', requireAuth, (req, res) => {
  const user = getCurrentUser(req);
  const habit = db
    .prepare('SELECT id FROM habits WHERE id = ? AND user_id = ? AND archived_at IS NULL')
    .get(req.params.id, user.id);

  if (!habit) {
    flash(req, 'Habit not found.');
    return res.redirect('/');
  }

  const today = todayIso();
  const existing = db
    .prepare('SELECT id FROM completions WHERE habit_id = ? AND completed_on = ?')
    .get(habit.id, today);

  if (existing) {
    db.prepare('DELETE FROM completions WHERE id = ?').run(existing.id);
  } else {
    db.prepare('INSERT INTO completions (habit_id, completed_on) VALUES (?, ?)').run(habit.id, today);
  }

  res.redirect('/');
});

app.post('/habits/:id/delete', requireAuth, (req, res) => {
  const user = getCurrentUser(req);
  db.prepare('DELETE FROM habits WHERE id = ? AND user_id = ?').run(req.params.id, user.id);
  res.redirect('/');
});

app.use((req, res) => {
  const user = getCurrentUser(req);
  res.status(404).send(
    layout({
      title: 'Not found',
      user,
      flashMessage: null,
      body: '<section class="auth-panel"><h1>Page not found</h1><p class="muted"><a href="/">Return to habits</a></p></section>'
    })
  );
});

app.listen(PORT, () => {
  console.log(`Habit tracker listening on http://localhost:${PORT}`);
});
