'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const SqliteStore = require('better-sqlite3-session-store')(session);

const db = require('./db');
const { csrf, currentUser, flash } = require('./middleware');
const authRoutes = require('./routes/auth');
const jobRoutes = require('./routes/jobs');

const PORT = Number(process.env.PORT) || 5038;
const isProd = process.env.NODE_ENV === 'production';

// Secrets must come from the environment — never hardcoded.
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET || SESSION_SECRET === 'change-me-to-a-long-random-string') {
  if (isProd) {
    console.error('FATAL: SESSION_SECRET must be set to a strong random value in production.');
    process.exit(1);
  }
  console.warn('WARNING: SESSION_SECRET is not set. Using an insecure development default. Set it in .env.');
}

const app = express();

// We sit behind no proxy locally, but enable it so Secure cookies work when
// deployed behind a TLS-terminating reverse proxy.
if (isProd) app.set('trust proxy', 1);

// --- Security headers -------------------------------------------------------
// Helmet sets sensible defaults incl. a restrictive Content-Security-Policy,
// which (together with output encoding) mitigates XSS. We only allow our own
// origin for scripts/styles — no inline scripts.
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
  })
);

// --- View engine ------------------------------------------------------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --- Body parsing -----------------------------------------------------------
// Only parse form bodies; cap the size to reduce abuse.
app.use(express.urlencoded({ extended: false, limit: '64kb' }));

// --- Static assets ----------------------------------------------------------
app.use('/static', express.static(path.join(__dirname, '..', 'public'), {
  maxAge: isProd ? '1d' : 0,
}));

// --- Sessions ---------------------------------------------------------------
app.use(
  session({
    store: new SqliteStore({
      client: db, // reuse the existing better-sqlite3 connection
      expired: { clear: true, intervalMs: 15 * 60 * 1000 },
    }),
    name: 'sid',
    secret: SESSION_SECRET || 'insecure-dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true, // not readable by JavaScript (mitigates XSS cookie theft)
      sameSite: 'lax', // mitigates CSRF for top-level navigations
      secure: process.env.COOKIE_SECURE === 'true' || isProd, // HTTPS-only when set
      maxAge: 1000 * 60 * 60 * 24, // 24h
    },
  })
);

// --- Per-request locals & CSRF ----------------------------------------------
app.use(currentUser);
app.use(flash);
app.use(csrf);

// --- Routes -----------------------------------------------------------------
app.use('/', authRoutes);
app.use('/', jobRoutes);

// --- 404 --------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).render('error', { status: 404, message: 'Page not found.' });
});

// --- Central error handler --------------------------------------------------
// Never leak stack traces or internal details to the client.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) {
    console.error(err); // logged server-side only
  }
  const message =
    status === 403 ? (err.message || 'Forbidden.') :
    status === 404 ? 'Page not found.' :
    status >= 500 ? 'Something went wrong on our end. Please try again later.' :
    (err.message || 'Request could not be processed.');

  if (res.headersSent) return next(err);
  res.status(status).render('error', { status, message });
});

app.listen(PORT, () => {
  console.log(`Job board running at http://localhost:${PORT}`);
});

module.exports = app;
