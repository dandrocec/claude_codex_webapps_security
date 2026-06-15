'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const { loadUser } = require('./middleware/auth');
const { csrfProtection } = require('./middleware/csrf');
const authRoutes = require('./routes/auth');
const bookmarkRoutes = require('./routes/bookmarks');

const app = express();
const isProd = process.env.NODE_ENV === 'production';

// --- Secrets: read from the environment, never hardcode ---------------------
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET || SESSION_SECRET === 'change-me-to-a-long-random-value') {
  if (isProd) {
    console.error('FATAL: SESSION_SECRET must be set to a strong value in production.');
    process.exit(1);
  } else {
    console.warn('WARNING: SESSION_SECRET is not set; using an insecure development default.');
  }
}
const PORT = parseInt(process.env.PORT, 10) || 5030;

// Behind a reverse proxy (e.g. in production) trust the first proxy so that
// Secure cookies and req.protocol work correctly.
if (isProd) app.set('trust proxy', 1);

// --- Views ------------------------------------------------------------------
// EJS auto-escapes <%= %> output -> context-aware encoding against XSS.
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --- Security headers (Helmet, incl. a strict Content-Security-Policy) -------
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
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
    // HSTS only makes sense over HTTPS.
    hsts: isProd,
  })
);

// --- Body parsing -----------------------------------------------------------
app.use(express.urlencoded({ extended: false, limit: '32kb' }));

// --- Static assets ----------------------------------------------------------
app.use('/static', express.static(path.join(__dirname, 'public'), {
  maxAge: isProd ? '1d' : 0,
}));

// --- Sessions (secure cookie configuration) ---------------------------------
app.use(
  session({
    name: 'sid',
    store: new SQLiteStore({ db: 'sessions.sqlite', dir: path.join(__dirname, '..', 'data') }),
    secret: SESSION_SECRET || 'insecure-dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true, // not readable from JavaScript
      secure: isProd, // only sent over HTTPS in production
      sameSite: 'lax', // mitigates CSRF on top-level navigations
      maxAge: 1000 * 60 * 60 * 8, // 8 hours
    },
  })
);

// --- Rate limiting on authentication endpoints ------------------------------
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many attempts. Please try again later.',
});

// --- Current user + CSRF for every request ----------------------------------
app.use(loadUser);
app.use(csrfProtection);

// --- Routes -----------------------------------------------------------------
app.get('/', (req, res) => {
  res.redirect(req.user ? '/bookmarks' : '/login');
});

app.use('/', authLimiter, authRoutes);
app.use('/bookmarks', bookmarkRoutes);

// --- 404 --------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).render('404');
});

// --- Centralised error handler (never leak stack traces) --------------------
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // Log full details server-side only.
  console.error(err);

  const status = err.status || 500;
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).render('error', {
      status: 403,
      message: 'Your session expired or the form token was invalid. Please go back and try again.',
    });
  }

  res.status(status).render('error', {
    status,
    message:
      status === 500
        ? 'Something went wrong. Please try again later.'
        : err.message || 'Request could not be processed.',
  });
});

app.listen(PORT, () => {
  console.log(`Bookmark manager listening on http://localhost:${PORT}`);
});

module.exports = app;
