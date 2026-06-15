'use strict';

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const SqliteStore = require('better-sqlite3-session-store')(session);

const config = require('./config');
const db = require('./db');
const { templateLocals } = require('./middleware/security');

const publicRoutes = require('./routes/public');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');

const app = express();

// Behind a reverse proxy (e.g. in production over HTTPS) trust the first hop so
// Secure cookies and rate limiting work correctly.
if (config.isProduction) app.set('trust proxy', 1);

// --- Views ------------------------------------------------------------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

// --- Security headers (OWASP) ----------------------------------------------
// Strict CSP: no inline scripts, only self-hosted assets. This is a strong
// defence-in-depth layer against XSS on top of output encoding.
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
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer' },
  })
);

// --- Body parsing (bounded to limit abuse) ----------------------------------
app.use(express.urlencoded({ extended: false, limit: '64kb' }));

// --- Sessions with secure cookie flags --------------------------------------
app.use(
  session({
    name: 'sid',
    store: new SqliteStore({
      client: db,
      expired: { clear: true, intervalMs: 15 * 60 * 1000 },
    }),
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true, // not readable by JS -> mitigates token theft via XSS
      secure: config.cookieSecure, // only sent over HTTPS when enabled
      sameSite: 'lax', // CSRF defence-in-depth
      maxAge: 1000 * 60 * 60 * 2, // 2 hours
    },
  })
);

// Expose CSRF token + current user to all views.
app.use(templateLocals);

// --- Static assets ----------------------------------------------------------
app.use(
  '/static',
  express.static(path.join(__dirname, '..', 'public'), {
    maxAge: '1h',
    dotfiles: 'ignore',
    index: false,
  })
);

// --- Routes -----------------------------------------------------------------
app.use('/', publicRoutes);
app.use('/', authRoutes);
app.use('/admin', adminRoutes);

// --- 404 --------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Not found',
    status: 404,
    message: 'The page you requested could not be found.',
  });
});

// --- Central error handler --------------------------------------------------
// Never leak stack traces or internal details to the client. Log full detail
// server-side; show the user a generic, safe message.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) {
    // eslint-disable-next-line no-console
    console.error(err);
  }
  const message = err.expose && err.message ? err.message : defaultMessage(status);
  res.status(status).render('error', { title: 'Error', status, message });
});

function defaultMessage(status) {
  if (status === 403) return 'Your request could not be verified. Please try again.';
  if (status === 404) return 'The page you requested could not be found.';
  if (status === 400) return 'Your request was invalid.';
  return 'Something went wrong. Please try again later.';
}

const server = app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`FAQ app listening on http://localhost:${config.port}`);
});

// Graceful shutdown.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}

module.exports = app;
