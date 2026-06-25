const crypto = require('crypto');
const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const csrf = require('csurf');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const Database = require('better-sqlite3');

const PORT = Number(process.env.PORT || 5015);
const SESSION_SECRET = process.env.SESSION_SECRET;
const BCRYPT_COST = Number(process.env.BCRYPT_COST || 12);
const COOKIE_SECURE =
  process.env.COOKIE_SECURE === 'true' ||
  (process.env.COOKIE_SECURE !== 'false' && process.env.NODE_ENV === 'production');
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'countdown.sqlite');

if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  console.error('SESSION_SECRET must be set to a random value of at least 32 characters.');
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

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
        ...(COOKIE_SECURE ? { upgradeInsecureRequests: [] } : {})
      }
    },
    referrerPolicy: { policy: 'no-referrer' }
  })
);

app.use(express.urlencoded({ extended: false, limit: '10kb' }));
app.use(
  session({
    name: 'countdown.sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    genid: () => crypto.randomUUID(),
    cookie: {
      httpOnly: true,
      secure: COOKIE_SECURE,
      sameSite: 'lax',
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

  CREATE TABLE IF NOT EXISTS countdowns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    label TEXT NOT NULL,
    target_date TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizeText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function validateUsername(username) {
  const clean = normalizeText(username).toLowerCase();
  if (!/^[a-z0-9_-]{3,32}$/.test(clean)) {
    return { error: 'Username must be 3-32 characters using letters, numbers, underscores, or hyphens.' };
  }
  return { value: clean };
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
    return { error: 'Password must be between 12 and 128 characters.' };
  }
  return { value: password };
}

function validateCountdown(label, targetDate) {
  const cleanLabel = normalizeText(label);
  if (cleanLabel.length < 1 || cleanLabel.length > 80) {
    return { error: 'Event label must be 1-80 characters.' };
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(targetDate || ''))) {
    return { error: 'Target date must use the YYYY-MM-DD format.' };
  }

  const parsed = new Date(`${targetDate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== targetDate) {
    return { error: 'Target date is not a valid calendar date.' };
  }

  return { value: { label: cleanLabel, targetDate } };
}

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.redirect('/login');
  }
  next();
}

function renderPage(req, res, options) {
  const title = escapeHtml(options.title || 'Countdown');
  const body = options.body || '';
  const headExtra = options.headExtra || '';
  const flash = options.flash ? `<div class="flash">${escapeHtml(options.flash)}</div>` : '';
  const userNav = req.session.userId
    ? `<form method="post" action="/logout" class="inline">
        <input type="hidden" name="_csrf" value="${escapeHtml(req.csrfToken())}">
        <button type="submit">Sign out</button>
      </form>`
    : `<a href="/login">Sign in</a>`;

  res.type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  ${headExtra}
  <style>
    :root { color-scheme: light dark; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f6f7f9; color: #17202a; }
    main { width: min(760px, calc(100% - 32px)); margin: 48px auto; }
    header { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 28px; }
    a { color: #0b5cad; }
    .panel { background: #fff; border: 1px solid #d9dee5; border-radius: 8px; padding: 24px; box-shadow: 0 8px 30px rgba(15, 23, 42, .08); }
    label { display: block; font-weight: 650; margin-top: 16px; }
    input { width: 100%; box-sizing: border-box; margin-top: 6px; padding: 11px 12px; border: 1px solid #aeb7c2; border-radius: 6px; font: inherit; }
    button, .button { display: inline-block; margin-top: 18px; padding: 10px 14px; border: 0; border-radius: 6px; background: #155e75; color: white; font: inherit; text-decoration: none; cursor: pointer; }
    .inline { display: inline; }
    .inline button { margin-top: 0; background: #52606d; }
    .flash { margin-bottom: 16px; padding: 12px; border-radius: 6px; background: #fff4d6; border: 1px solid #e6c76a; }
    .count { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 24px; }
    .unit { border: 1px solid #d9dee5; border-radius: 8px; padding: 18px; text-align: center; background: #fbfcfd; }
    .num { font-size: clamp(2rem, 9vw, 4rem); font-weight: 800; line-height: 1; }
    .small { color: #52606d; font-size: .95rem; }
    @media (max-width: 560px) { .count { grid-template-columns: repeat(2, 1fr); } header { align-items: flex-start; flex-direction: column; } }
    @media (prefers-color-scheme: dark) {
      body { background: #0f1720; color: #eef2f7; }
      .panel, .unit { background: #17202a; border-color: #334155; }
      input { background: #111827; border-color: #475569; color: #eef2f7; }
      .small { color: #bac4d0; }
      .flash { background: #3a2c10; border-color: #8a6b17; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>${title}</h1>
      <nav>${userNav}</nav>
    </header>
    ${flash}
    ${body}
  </main>
</body>
</html>`);
}

app.use(csrfProtection);

app.get('/', (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  res.redirect('/countdowns/new');
});

app.get('/register', (req, res) => {
  renderPage(req, res, {
    title: 'Create Account',
    flash: req.query.error,
    body: `<section class="panel">
      <form method="post" action="/register" autocomplete="off">
        <input type="hidden" name="_csrf" value="${escapeHtml(req.csrfToken())}">
        <label for="username">Username</label>
        <input id="username" name="username" required minlength="3" maxlength="32" pattern="[A-Za-z0-9_-]{3,32}">
        <label for="password">Password</label>
        <input id="password" name="password" type="password" required minlength="12" maxlength="128">
        <button type="submit">Create account</button>
      </form>
      <p class="small">Already have an account? <a href="/login">Sign in</a>.</p>
    </section>`
  });
});

app.post('/register', authLimiter, async (req, res, next) => {
  try {
    const username = validateUsername(req.body.username);
    const password = validatePassword(req.body.password);
    if (username.error || password.error) {
      return res.redirect(`/register?error=${encodeURIComponent(username.error || password.error)}`);
    }

    const passwordHash = await bcrypt.hash(password.value, BCRYPT_COST);
    const insertUser = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)');
    const result = insertUser.run(username.value, passwordHash);
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = result.lastInsertRowid;
      req.session.username = username.value;
      res.redirect('/countdowns/new');
    });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.redirect('/register?error=Username%20is%20already%20taken.');
    }
    next(err);
  }
});

app.get('/login', (req, res) => {
  renderPage(req, res, {
    title: 'Sign In',
    flash: req.query.error,
    body: `<section class="panel">
      <form method="post" action="/login" autocomplete="off">
        <input type="hidden" name="_csrf" value="${escapeHtml(req.csrfToken())}">
        <label for="username">Username</label>
        <input id="username" name="username" required minlength="3" maxlength="32">
        <label for="password">Password</label>
        <input id="password" name="password" type="password" required minlength="12" maxlength="128">
        <button type="submit">Sign in</button>
      </form>
      <p class="small">Need an account? <a href="/register">Create one</a>.</p>
    </section>`
  });
});

app.post('/login', authLimiter, async (req, res, next) => {
  try {
    const username = validateUsername(req.body.username);
    const password = validatePassword(req.body.password);
    if (username.error || password.error) {
      return res.redirect('/login?error=Invalid%20username%20or%20password.');
    }

    const user = db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username.value);
    const ok = user ? await bcrypt.compare(password.value, user.password_hash) : false;
    if (!ok) return res.redirect('/login?error=Invalid%20username%20or%20password.');

    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = user.id;
      req.session.username = user.username;
      res.redirect('/countdowns/new');
    });
  } catch (err) {
    next(err);
  }
});

app.post('/logout', requireAuth, (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('countdown.sid');
    res.redirect('/login');
  });
});

app.get('/countdowns/new', requireAuth, (req, res) => {
  renderPage(req, res, {
    title: 'New Countdown',
    flash: req.query.error,
    body: `<section class="panel">
      <form method="post" action="/countdowns">
        <input type="hidden" name="_csrf" value="${escapeHtml(req.csrfToken())}">
        <label for="label">Event label</label>
        <input id="label" name="label" required minlength="1" maxlength="80" placeholder="Launch day">
        <label for="targetDate">Target date</label>
        <input id="targetDate" name="targetDate" type="date" required>
        <button type="submit">Create countdown</button>
      </form>
    </section>`
  });
});

app.post('/countdowns', requireAuth, (req, res) => {
  const countdown = validateCountdown(req.body.label, req.body.targetDate);
  if (countdown.error) {
    return res.redirect(`/countdowns/new?error=${encodeURIComponent(countdown.error)}`);
  }

  const insertCountdown = db.prepare(
    'INSERT INTO countdowns (user_id, label, target_date) VALUES (?, ?, ?)'
  );
  const result = insertCountdown.run(
    req.session.userId,
    countdown.value.label,
    countdown.value.targetDate
  );
  res.redirect(`/countdowns/${result.lastInsertRowid}`);
});

app.get('/countdowns/:id', requireAuth, (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(404).send('Not found');

  const countdown = db
    .prepare('SELECT id, label, target_date FROM countdowns WHERE id = ? AND user_id = ?')
    .get(Number(req.params.id), req.session.userId);
  if (!countdown) return res.status(404).send('Not found');

  const target = new Date(`${countdown.target_date}T00:00:00.000Z`);
  const now = new Date();
  const remainingMs = Math.max(0, target.getTime() - now.getTime());
  const days = Math.floor(remainingMs / 86400000);
  const hours = Math.floor((remainingMs % 86400000) / 3600000);
  const minutes = Math.floor((remainingMs % 3600000) / 60000);
  const seconds = Math.floor((remainingMs % 60000) / 1000);

  renderPage(req, res, {
    title: countdown.label,
    headExtra: '<meta http-equiv="refresh" content="1">',
    body: `<section class="panel">
      <p class="small">Counting down to ${escapeHtml(countdown.target_date)}</p>
      <div class="count" aria-label="Countdown">
        <div class="unit"><div class="num">${days}</div><div>Days</div></div>
        <div class="unit"><div class="num">${hours}</div><div>Hours</div></div>
        <div class="unit"><div class="num">${minutes}</div><div>Minutes</div></div>
        <div class="unit"><div class="num">${seconds}</div><div>Seconds</div></div>
      </div>
      <p><a class="button" href="/countdowns/new">Create another</a></p>
    </section>`
  });
});

app.use((req, res) => {
  res.status(404).type('html').send('<h1>Not found</h1>');
});

app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).type('html').send('<h1>Invalid request token</h1>');
  }
  console.error(err);
  res.status(500).type('html').send('<h1>Something went wrong</h1>');
});

app.listen(PORT, () => {
  console.log(`Countdown app listening on port ${PORT}`);
});
