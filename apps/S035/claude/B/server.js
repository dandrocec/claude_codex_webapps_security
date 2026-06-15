'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const SqliteStore = require('better-sqlite3-session-store')(session);

const db = require('./db');
const { csrfProvider, csrfProtect } = require('./middleware/security');
const authRoutes = require('./routes/auth');
const habitRoutes = require('./routes/habits');

const app = express();

const PORT = process.env.PORT || 5035;
const isProd = process.env.NODE_ENV === 'production';

// --- Secrets come from the environment; never hardcoded. ---
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  console.error(
    'FATAL: SESSION_SECRET is not set. Copy .env.example to .env and set a strong value.'
  );
  process.exit(1);
}

// Behind a reverse proxy/TLS terminator, trust it so 'secure' cookies work.
app.set('trust proxy', 1);

// --- Security headers (incl. a restrictive Content-Security-Policy). ---
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    referrerPolicy: { policy: 'no-referrer' },
  })
);

// --- View engine: EJS auto-escapes <%= %>, giving context-aware HTML encoding. ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Static assets (CSS only — keeps CSP free of inline styles/scripts).
app.use('/static', express.static(path.join(__dirname, 'public'), {
  maxAge: isProd ? '1d' : 0,
}));

// Parse form bodies only; cap size to limit abuse.
app.use(express.urlencoded({ extended: false, limit: '16kb' }));

// --- Sessions with a persistent SQLite store and hardened cookies. ---
app.use(
  session({
    name: 'sid',
    store: new SqliteStore({
      client: db,
      expired: { clear: true, intervalMs: 15 * 60 * 1000 },
    }),
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,           // not readable from JS
      secure: 'auto',           // Secure flag when served over HTTPS
      sameSite: 'lax',          // CSRF defence in depth
      maxAge: 1000 * 60 * 60 * 8, // 8 hours
    },
  })
);

// --- Rate limiting on auth endpoints to slow brute-force attempts. ---
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many attempts. Please try again later.',
});

// --- CSRF: provide token to views, then enforce on every mutating request. ---
app.use(csrfProvider);
app.use(csrfProtect);

// Expose current user to all views.
app.use((req, res, next) => {
  res.locals.currentUser = req.session.userId
    ? { id: req.session.userId, username: req.session.username }
    : null;
  next();
});

// --- Routes ---
app.use(['/login', '/register'], authLimiter);
app.use('/', authRoutes);
app.use('/', habitRoutes);

// --- 404 handler ---
app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Not found',
    message: 'The page you requested does not exist.',
  });
});

// --- Central error handler: logs server-side, never leaks internals. ---
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', {
    title: 'Error',
    message: 'Something went wrong. Please try again.',
  });
});

app.listen(PORT, () => {
  console.log(`Habit tracker running at http://localhost:${PORT}`);
});

module.exports = app;
