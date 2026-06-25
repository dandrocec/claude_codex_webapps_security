'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const csrf = require('csurf');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');
const { escapeHtml, escapeAttr } = require('./view-helpers');

const PORT = Number.parseInt(process.env.PORT || '5020', 10);
const SESSION_SECRET = process.env.SESSION_SECRET;
const COOKIE_SECURE = process.env.COOKIE_SECURE !== 'false';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.sqlite');
const MAX_JSON_CHARS = 100000;

if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET must be set to at least 32 characters.');
}

const app = express();
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS snippets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    formatted_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.locals.escapeHtml = escapeHtml;
app.locals.escapeAttr = escapeAttr;
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(express.static(path.join(__dirname, 'public'), {
  dotfiles: 'deny',
  etag: true,
  maxAge: '1h'
}));
app.use(express.urlencoded({ extended: false, limit: '128kb' }));
app.use(session({
  name: 'sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  genid: () => crypto.randomUUID(),
  cookie: {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: 'strict',
    maxAge: 1000 * 60 * 60
  }
}));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false
});

const csrfProtection = csrf();

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

app.use(csrfProtection);

app.use((req, res, next) => {
  res.locals.csrfToken = req.csrfToken();
  res.locals.notice = null;
  res.locals.error = null;
  next();
});

function cleanUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function validateCredentials(username, password) {
  if (!/^[a-z0-9_-]{3,32}$/.test(username)) {
    return 'Username must be 3-32 characters and use only letters, numbers, underscores, or hyphens.';
  }
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
    return 'Password must be 12-128 characters.';
  }
  return null;
}

function requireUser(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  return next();
}

function renderHome(req, res, values = {}) {
  const snippets = req.session.user
    ? db.prepare('SELECT id, title, created_at FROM snippets WHERE user_id = ? ORDER BY id DESC LIMIT 20').all(req.session.user.id)
    : [];

  res.render('index', {
    input: values.input || '',
    formatted: values.formatted || '',
    parseError: values.parseError || '',
    snippets,
    notice: values.notice || null
  });
}

app.get('/', requireUser, (req, res) => {
  renderHome(req, res);
});

app.get('/register', (req, res) => {
  res.render('register');
});

app.post('/register', authLimiter, async (req, res, next) => {
  try {
    const username = cleanUsername(req.body.username);
    const password = String(req.body.password || '');
    const validationError = validateCredentials(username, password);

    if (validationError) {
      res.status(400);
      return res.render('register', { error: validationError });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const result = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, passwordHash);
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = { id: result.lastInsertRowid, username };
      return res.redirect('/');
    });
  } catch (err) {
    if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(409);
      return res.render('register', { error: 'That username is already taken.' });
    }
    return next(err);
  }
});

app.get('/login', (req, res) => {
  res.render('login');
});

app.post('/login', authLimiter, async (req, res, next) => {
  try {
    const username = cleanUsername(req.body.username);
    const password = String(req.body.password || '');
    const user = db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username);
    const validPassword = user ? await bcrypt.compare(password, user.password_hash) : false;

    if (!validPassword) {
      res.status(401);
      return res.render('login', { error: 'Invalid username or password.' });
    }

    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = { id: user.id, username: user.username };
      return res.redirect('/');
    });
  } catch (err) {
    return next(err);
  }
});

app.post('/logout', requireUser, (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('sid');
    return res.redirect('/login');
  });
});

app.post('/format', requireUser, (req, res) => {
  const input = typeof req.body.jsonInput === 'string' ? req.body.jsonInput : '';

  if (!input.trim()) {
    res.status(400);
    return renderHome(req, res, { input, parseError: 'Paste JSON before submitting.' });
  }

  if (input.length > MAX_JSON_CHARS) {
    res.status(413);
    return renderHome(req, res, { input: input.slice(0, MAX_JSON_CHARS), parseError: 'JSON input is too large.' });
  }

  try {
    const parsed = JSON.parse(input);
    const formatted = JSON.stringify(parsed, null, 2);
    return renderHome(req, res, { input, formatted });
  } catch (err) {
    res.status(400);
    return renderHome(req, res, { input, parseError: err.message });
  }
});

app.post('/snippets', requireUser, (req, res) => {
  const title = String(req.body.title || '').trim().slice(0, 80) || 'Untitled JSON';
  const formattedJson = String(req.body.formattedJson || '');

  if (!formattedJson || formattedJson.length > MAX_JSON_CHARS) {
    res.status(400);
    return renderHome(req, res, { parseError: 'Only validated formatted JSON can be saved.' });
  }

  try {
    JSON.parse(formattedJson);
  } catch {
    res.status(400);
    return renderHome(req, res, { parseError: 'Only valid JSON can be saved.' });
  }

  db.prepare('INSERT INTO snippets (user_id, title, formatted_json) VALUES (?, ?, ?)').run(req.session.user.id, title, formattedJson);
  return renderHome(req, res, { formatted: formattedJson, notice: 'Saved.' });
});

app.get('/snippets/:id', requireUser, (req, res, next) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(404).render('not-found');

  const snippet = db.prepare('SELECT id, title, formatted_json, created_at FROM snippets WHERE id = ? AND user_id = ?').get(id, req.session.user.id);
  if (!snippet) return res.status(404).render('not-found');

  return res.render('snippet', { snippet });
});

app.post('/snippets/:id/delete', requireUser, (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (Number.isInteger(id)) {
    db.prepare('DELETE FROM snippets WHERE id = ? AND user_id = ?').run(id, req.session.user.id);
  }
  return res.redirect('/');
});

app.use((req, res) => {
  res.status(404).render('not-found');
});

app.use((err, req, res, next) => {
  res.locals.user = req.session ? req.session.user || null : null;
  res.locals.csrfToken = '';

  if (err.code === 'EBADCSRFTOKEN') {
    res.status(403);
    return res.render('error', { message: 'The form expired or was submitted from an invalid origin.' });
  }

  console.error(err);
  res.status(500);
  return res.render('error', { message: 'Something went wrong. Please try again.' });
});

app.listen(PORT, () => {
  console.log(`JSON formatter listening on port ${PORT}`);
});
