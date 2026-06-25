require('dotenv').config();

const crypto = require('crypto');
const path = require('path');
const argon2 = require('argon2');
const Database = require('better-sqlite3');
const SQLiteStoreFactory = require('connect-sqlite3');
const csrf = require('csurf');
const express = require('express');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const helmet = require('helmet');
const validator = require('validator');

const app = express();
const SQLiteStore = SQLiteStoreFactory(session);
const isProduction = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT || 5024);
const sessionSecret = process.env.SESSION_SECRET;

if (!sessionSecret || sessionSecret.length < 32) {
  throw new Error('SESSION_SECRET must be set to at least 32 characters.');
}

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'data.sqlite');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS redirects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    redirect_key TEXT NOT NULL,
    destination_url TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, redirect_key),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

const statements = {
  findUserByUsername: db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?'),
  findUserById: db.prepare('SELECT id, username FROM users WHERE id = ?'),
  createUser: db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)'),
  listRedirects: db.prepare(`
    SELECT id, redirect_key, destination_url, created_at, updated_at
    FROM redirects
    WHERE user_id = ?
    ORDER BY redirect_key COLLATE NOCASE ASC
  `),
  findRedirectByKey: db.prepare(`
    SELECT destination_url
    FROM redirects
    WHERE user_id = ? AND redirect_key = ?
  `),
  upsertRedirect: db.prepare(`
    INSERT INTO redirects (user_id, redirect_key, destination_url)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, redirect_key)
    DO UPDATE SET destination_url = excluded.destination_url, updated_at = CURRENT_TIMESTAMP
  `)
};

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');
app.set('trust proxy', isProduction ? 1 : false);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'none'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

app.use(express.urlencoded({ extended: false, limit: '10kb' }));

app.use(session({
  name: 'sid',
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  store: new SQLiteStore({
    db: 'sessions.sqlite',
    dir: __dirname
  }),
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 2
  }
}));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false
});

const csrfProtection = csrf();

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.messages = req.session.messages || [];
  delete req.session.messages;
  next();
});

function flash(req, type, text) {
  req.session.messages = req.session.messages || [];
  req.session.messages.push({ type, text });
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    flash(req, 'error', 'Please sign in first.');
    return res.redirect('/login');
  }
  return next();
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

function validateUsername(value) {
  const username = String(value || '').trim();
  if (!validator.isLength(username, { min: 3, max: 32 })) {
    return { error: 'Username must be 3 to 32 characters.' };
  }
  if (!validator.isAlphanumeric(username, 'en-US', { ignore: '_-' })) {
    return { error: 'Username may contain letters, numbers, underscores, and hyphens.' };
  }
  return { value: username };
}

function validatePassword(value) {
  const password = String(value || '');
  if (!validator.isLength(password, { min: 12, max: 256 })) {
    return { error: 'Password must be at least 12 characters.' };
  }
  return { value: password };
}

function validateRedirectKey(value) {
  const redirectKey = normalizeKey(value);
  if (!validator.isLength(redirectKey, { min: 1, max: 64 })) {
    return { error: 'Key must be 1 to 64 characters.' };
  }
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(redirectKey)) {
    return { error: 'Key must start with a letter or number and use only lowercase letters, numbers, underscores, or hyphens.' };
  }
  return { value: redirectKey };
}

function validateDestinationUrl(value) {
  const destinationUrl = String(value || '').trim();
  if (!validator.isLength(destinationUrl, { min: 8, max: 2048 })) {
    return { error: 'Destination URL must be between 8 and 2048 characters.' };
  }
  if (!validator.isURL(destinationUrl, {
    require_protocol: true,
    protocols: ['http', 'https'],
    require_valid_protocol: true,
    allow_underscores: false
  })) {
    return { error: 'Destination URL must be a valid http or https URL.' };
  }
  return { value: destinationUrl };
}

function renderForm(req, res, view, fields = {}, status = 200) {
  return res.status(status).render(view, {
    csrfToken: req.csrfToken(),
    fields
  });
}

app.get('/', (req, res) => {
  if (req.session.user) {
    return res.redirect('/redirects');
  }
  return res.redirect('/login');
});

app.get('/register', csrfProtection, (req, res) => {
  renderForm(req, res, 'register');
});

app.post('/register', authLimiter, csrfProtection, async (req, res, next) => {
  try {
    const usernameResult = validateUsername(req.body.username);
    const passwordResult = validatePassword(req.body.password);

    if (usernameResult.error || passwordResult.error) {
      flash(req, 'error', usernameResult.error || passwordResult.error);
      return renderForm(req, res, 'register', { username: req.body.username }, 400);
    }

    const passwordHash = await argon2.hash(passwordResult.value, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 3,
      parallelism: 1
    });

    const result = statements.createUser.run(usernameResult.value, passwordHash);
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = { id: result.lastInsertRowid, username: usernameResult.value };
      return res.redirect('/redirects');
    });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      flash(req, 'error', 'That username is already registered.');
      return renderForm(req, res, 'register', { username: req.body.username }, 409);
    }
    return next(error);
  }
});

app.get('/login', csrfProtection, (req, res) => {
  renderForm(req, res, 'login');
});

app.post('/login', authLimiter, csrfProtection, async (req, res, next) => {
  try {
    const usernameResult = validateUsername(req.body.username);
    const password = String(req.body.password || '');

    if (usernameResult.error || !password) {
      flash(req, 'error', 'Invalid username or password.');
      return renderForm(req, res, 'login', { username: req.body.username }, 400);
    }

    const user = statements.findUserByUsername.get(usernameResult.value);
    const verified = user ? await argon2.verify(user.password_hash, password) : false;

    if (!verified) {
      await argon2.hash(crypto.randomBytes(16).toString('hex'));
      flash(req, 'error', 'Invalid username or password.');
      return renderForm(req, res, 'login', { username: req.body.username }, 401);
    }

    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = { id: user.id, username: user.username };
      return res.redirect('/redirects');
    });
  } catch (error) {
    return next(error);
  }
});

app.post('/logout', csrfProtection, requireAuth, (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('sid');
    return res.redirect('/login');
  });
});

app.get('/redirects', csrfProtection, requireAuth, (req, res) => {
  const redirects = statements.listRedirects.all(req.session.user.id);
  res.render('redirects', {
    csrfToken: req.csrfToken(),
    redirects,
    fields: {}
  });
});

app.post('/redirects', csrfProtection, requireAuth, (req, res) => {
  const keyResult = validateRedirectKey(req.body.redirectKey);
  const urlResult = validateDestinationUrl(req.body.destinationUrl);
  const redirects = statements.listRedirects.all(req.session.user.id);

  if (keyResult.error || urlResult.error) {
    flash(req, 'error', keyResult.error || urlResult.error);
    return res.status(400).render('redirects', {
      csrfToken: req.csrfToken(),
      redirects,
      fields: {
        redirectKey: req.body.redirectKey,
        destinationUrl: req.body.destinationUrl
      }
    });
  }

  statements.upsertRedirect.run(req.session.user.id, keyResult.value, urlResult.value);
  flash(req, 'success', 'Redirect saved.');
  return res.redirect('/redirects');
});

app.get('/go', requireAuth, (req, res) => {
  const keyResult = validateRedirectKey(req.query.to);
  if (keyResult.error) {
    return res.status(400).render('error', { csrfToken: null, message: 'Invalid redirect key.' });
  }

  const redirectRecord = statements.findRedirectByKey.get(req.session.user.id, keyResult.value);
  if (!redirectRecord) {
    return res.status(404).render('error', { csrfToken: null, message: 'Redirect not found.' });
  }

  return res.redirect(302, redirectRecord.destination_url);
});

app.use((req, res) => {
  res.status(404).render('error', { csrfToken: null, message: 'Page not found.' });
});

app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).render('error', { csrfToken: null, message: 'Invalid or expired form token.' });
  }

  console.error(err);
  return res.status(500).render('error', { csrfToken: null, message: 'Something went wrong.' });
});

app.listen(port, () => {
  console.log(`Redirect registry listening on port ${port}`);
});
