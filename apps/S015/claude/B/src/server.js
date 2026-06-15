'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const rateLimit = require('express-rate-limit');

const { csrfProtection, exposeUser } = require('./middleware/security');
const authRoutes = require('./routes/auth');
const eventRoutes = require('./routes/events');

const app = express();

const PORT = Number(process.env.PORT) || 5015;
const isProd = process.env.NODE_ENV === 'production';

// --- Secrets: read from environment, never hardcode. -----------------------
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  if (isProd) {
    // Refuse to boot insecurely in production.
    console.error('FATAL: SESSION_SECRET is not set.');
    process.exit(1);
  }
  console.warn(
    'WARNING: SESSION_SECRET is not set; using an insecure development default.'
  );
}

// Trust the first proxy so "secure" cookies work behind a TLS terminator.
app.set('trust proxy', 1);

// --- Security headers (helmet sets sensible defaults + a strict CSP). ------
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
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
      },
    },
    referrerPolicy: { policy: 'no-referrer' },
  })
);

// --- View engine & static assets. ------------------------------------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Parse only URL-encoded form bodies; cap the size to limit abuse.
app.use(express.urlencoded({ extended: false, limit: '16kb' }));

// --- Sessions with secure cookies. -----------------------------------------
app.use(
  session({
    name: 'sid',
    store: new SQLiteStore({ db: 'sessions.sqlite', dir: path.join(__dirname, '..', 'data') }),
    secret: SESSION_SECRET || 'insecure-dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true, // not readable by JavaScript -> mitigates XSS cookie theft
      sameSite: 'lax', // mitigates CSRF on top of the token check
      secure: process.env.COOKIE_SECURE === 'true' || isProd, // HTTPS-only when set
      maxAge: 1000 * 60 * 60 * 8, // 8 hours
    },
  })
);

// Basic rate limiting to slow down brute-force / abuse on auth endpoints.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(exposeUser);
app.use(csrfProtection);

// --- Routes. ----------------------------------------------------------------
app.use('/', authLimiter, authRoutes);
app.use('/', eventRoutes);

// 404 handler.
app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Not found',
    message: 'The page you requested does not exist.',
  });
});

// --- Central error handler: log internally, never leak details to clients. -
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err); // full detail stays server-side
  res.status(500).render('error', {
    title: 'Something went wrong',
    message: 'An unexpected error occurred. Please try again later.',
  });
});

app.listen(PORT, () => {
  console.log(`Countdown app listening on http://localhost:${PORT}`);
});

module.exports = app;
