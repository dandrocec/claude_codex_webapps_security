require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const helmet = require('helmet');
const csrf = require('csurf');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');
const { body, validationResult } = require('express-validator');

const app = express();
const PORT = Number(process.env.PORT || 5018);
const SESSION_SECRET = process.env.SESSION_SECRET;
const DATA_DIR = path.join(__dirname, 'data');

if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET must be set to at least 32 characters.');
}

fs.mkdirSync(DATA_DIR, { recursive: true });

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"]
    }
  },
  referrerPolicy: { policy: 'no-referrer' },
  crossOriginOpenerPolicy: { policy: 'same-origin' }
}));

app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 150,
  standardHeaders: true,
  legacyHeaders: false
}));

app.use(session({
  name: 'pwd_strength.sid',
  store: new SQLiteStore({
    db: 'sessions.sqlite',
    dir: DATA_DIR
  }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge: 60 * 60 * 1000
  }
}));

app.use(csrf());

const db = new Database(path.join(DATA_DIR, 'app.sqlite'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS password_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    rating TEXT NOT NULL,
    feedback TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

const registerUser = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)');
const findUserByName = db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?');
const findUserById = db.prepare('SELECT id, username FROM users WHERE id = ?');
const insertCheck = db.prepare('INSERT INTO password_checks (user_id, rating, feedback) VALUES (?, ?, ?)');
const listChecks = db.prepare('SELECT id, rating, feedback, created_at FROM password_checks WHERE user_id = ? ORDER BY id DESC LIMIT 10');
const getCheckForUser = db.prepare('SELECT id, rating, feedback, created_at FROM password_checks WHERE id = ? AND user_id = ?');
const deleteCheckForUser = db.prepare('DELETE FROM password_checks WHERE id = ? AND user_id = ?');

app.use((req, res, next) => {
  res.locals.csrfToken = req.csrfToken();
  res.locals.user = req.session.userId ? findUserById.get(req.session.userId) : null;
  res.locals.error = null;
  res.locals.result = null;
  next();
});

function ensureAuthenticated(req, res, next) {
  if (!req.session.userId) {
    return res.redirect('/login');
  }
  return next();
}

function renderWithErrors(req, res, view, status, data = {}) {
  const errors = validationResult(req);
  const message = errors.array().map((err) => err.msg).join(' ');
  return res.status(status).render(view, {
    ...data,
    error: message || 'Please check your input and try again.'
  });
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function evaluatePassword(password) {
  const feedback = [];
  let score = 0;

  if (password.length >= 12) score += 2;
  else if (password.length >= 8) score += 1;
  else feedback.push('Use at least 8 characters; 12 or more is better.');

  const checks = [
    { ok: /[a-z]/.test(password), message: 'Add lowercase letters.' },
    { ok: /[A-Z]/.test(password), message: 'Add uppercase letters.' },
    { ok: /\d/.test(password), message: 'Add numbers.' },
    { ok: /[^A-Za-z0-9]/.test(password), message: 'Add symbols.' }
  ];

  const variety = checks.filter((check) => check.ok).length;
  score += variety;
  checks.filter((check) => !check.ok).forEach((check) => feedback.push(check.message));

  if (/(.)\1{2,}/.test(password)) {
    score -= 1;
    feedback.push('Avoid repeated characters.');
  }

  if (/password|qwerty|letmein|admin|welcome/i.test(password)) {
    score -= 2;
    feedback.push('Avoid common words and keyboard patterns.');
  }

  let rating = 'weak';
  if (score >= 6 && password.length >= 12 && variety >= 3) rating = 'strong';
  else if (score >= 4 && password.length >= 8 && variety >= 2) rating = 'medium';

  if (feedback.length === 0) {
    feedback.push('Good variety and length. Consider using a unique passphrase for each account.');
  }

  return { rating, feedback: feedback.join(' ') };
}

app.get('/', ensureAuthenticated, (req, res) => {
  res.render('index', { checks: listChecks.all(req.session.userId) });
});

app.get('/register', (req, res) => {
  res.render('register');
});

app.post('/register',
  body('username')
    .customSanitizer(normalizeUsername)
    .isLength({ min: 3, max: 40 }).withMessage('Username must be 3 to 40 characters.')
    .matches(/^[a-z0-9_.-]+$/).withMessage('Username may contain letters, numbers, dots, underscores, and hyphens.'),
  body('password')
    .isLength({ min: 12, max: 128 }).withMessage('Account password must be 12 to 128 characters.'),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return renderWithErrors(req, res, 'register', 400);

    try {
      const passwordHash = await bcrypt.hash(req.body.password, 12);
      const info = registerUser.run(normalizeUsername(req.body.username), passwordHash);
      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.userId = info.lastInsertRowid;
        return res.redirect('/');
      });
    } catch (err) {
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return res.status(409).render('register', { error: 'That username is already taken.' });
      }
      return next(err);
    }
  }
);

app.get('/login', (req, res) => {
  res.render('login');
});

app.post('/login',
  body('username').customSanitizer(normalizeUsername).isLength({ min: 3, max: 40 }).withMessage('Enter a valid username.'),
  body('password').isLength({ min: 1, max: 128 }).withMessage('Enter your password.'),
  async (req, res, next) => {
    if (!validationResult(req).isEmpty()) return renderWithErrors(req, res, 'login', 400);

    try {
      const user = findUserByName.get(normalizeUsername(req.body.username));
      const ok = user ? await bcrypt.compare(req.body.password, user.password_hash) : false;
      if (!ok) return res.status(401).render('login', { error: 'Invalid username or password.' });

      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.userId = user.id;
        return res.redirect('/');
      });
    } catch (err) {
      return next(err);
    }
  }
);

app.post('/logout', ensureAuthenticated, (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('pwd_strength.sid');
    return res.redirect('/login');
  });
});

app.post('/check',
  ensureAuthenticated,
  body('candidate')
    .isString().withMessage('Enter a candidate password.')
    .isLength({ min: 1, max: 128 }).withMessage('Candidate password must be 1 to 128 characters.')
    .trim(),
  (req, res) => {
    if (!validationResult(req).isEmpty()) {
      return renderWithErrors(req, res, 'index', 400, { checks: listChecks.all(req.session.userId) });
    }

    const candidate = req.body.candidate;
    const result = evaluatePassword(candidate);
    insertCheck.run(req.session.userId, result.rating, result.feedback);
    return res.render('index', {
      result,
      checks: listChecks.all(req.session.userId)
    });
  }
);

app.get('/checks/:id',
  ensureAuthenticated,
  (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(404).render('not-found');

    const check = getCheckForUser.get(id, req.session.userId);
    if (!check) return res.status(404).render('not-found');
    return res.render('check', { check });
  }
);

app.post('/checks/:id/delete',
  ensureAuthenticated,
  (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (Number.isInteger(id) && id > 0) {
      deleteCheckForUser.run(id, req.session.userId);
    }
    return res.redirect('/');
  }
);

app.use((req, res) => {
  res.status(404).render('not-found');
});

app.use((err, req, res, next) => {
  res.locals.user = res.locals.user || null;
  res.locals.csrfToken = res.locals.csrfToken || '';

  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).render('error', { message: 'Your form expired. Please go back and try again.' });
  }

  const requestId = crypto.randomUUID();
  console.error(`[${requestId}]`, err);
  return res.status(500).render('error', { message: `Something went wrong. Reference: ${requestId}` });
});

function getTlsOptions() {
  if (process.env.TLS_KEY_PATH && process.env.TLS_CERT_PATH) {
    return {
      key: fs.readFileSync(process.env.TLS_KEY_PATH),
      cert: fs.readFileSync(process.env.TLS_CERT_PATH)
    };
  }

  const selfsigned = require('selfsigned');
  const cert = selfsigned.generate(
    [{ name: 'commonName', value: 'localhost' }],
    { days: 30, keySize: 2048, algorithm: 'sha256' }
  );
  return { key: cert.private, cert: cert.cert };
}

https.createServer(getTlsOptions(), app).listen(PORT, () => {
  console.log(`Password strength app listening at https://localhost:${PORT}`);
});
