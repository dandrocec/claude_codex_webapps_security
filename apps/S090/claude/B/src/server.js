'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const SqliteStore = require('better-sqlite3-session-store')(session);

const config = require('./config');
const passport = require('./auth');
const { sessionDb } = require('./db');
const { templateLocals } = require('./middleware');
const routes = require('./routes');

const app = express();

// Behind a reverse proxy (e.g. in production) trust it so Secure cookies and
// the client IP for rate limiting work correctly.
if (config.isProduction) app.set('trust proxy', 1);

// --- Security headers (Helmet) ---------------------------------------------
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        // GitHub serves avatars from avatars.githubusercontent.com.
        imgSrc: ["'self'", 'data:', 'https://avatars.githubusercontent.com'],
        connectSrc: ["'self'"],
        formAction: ["'self'", 'https://github.com'],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        upgradeInsecureRequests: config.isProduction ? [] : null,
      },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' },
    hsts: config.isProduction ? { maxAge: 31536000, includeSubDomains: true } : false,
  })
);

// --- Views & body parsing --------------------------------------------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
// EJS `<%= %>` performs HTML-escaping = context-aware output encoding for XSS.

// Limit body size; only urlencoded forms are used.
app.use(express.urlencoded({ extended: false, limit: '16kb' }));

app.use(
  express.static(path.join(__dirname, '..', 'public'), {
    maxAge: '1h',
    setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
  })
);

// --- Sessions (persisted in SQLite) ----------------------------------------
app.use(
  session({
    name: 'sid', // generic name, don't advertise the framework
    secret: config.sessionSecret,
    store: new SqliteStore({
      client: sessionDb,
      expired: { clear: true, intervalMs: 15 * 60 * 1000 },
    }),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true, // not readable by JS -> mitigates token theft via XSS
      secure: config.cookieSecure, // only over HTTPS when enabled
      sameSite: 'lax', // mitigates CSRF on top-level navigations
      maxAge: 1000 * 60 * 60 * 8, // 8 hours
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());
app.use(templateLocals);

// --- Rate limiting ---------------------------------------------------------
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(generalLimiter);
app.use(['/auth', '/logout'], authLimiter);

// --- Routes ----------------------------------------------------------------
app.use('/', routes);

// --- 404 -------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).render('error', { status: 404, message: 'Page not found' });
});

// --- Central error handler -------------------------------------------------
// Logs full details server-side; sends only a safe, generic message to clients
// (no stack traces or internal error text leak out).
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  // eslint-disable-next-line no-console
  console.error(`[error] ${req.method} ${req.originalUrl}`, err);

  const message =
    err.expose && err.message ? err.message : 'Something went wrong. Please try again.';

  if (res.headersSent) return next(err);

  // Content negotiation: JSON for API-ish requests, HTML otherwise.
  if (req.accepts('html')) {
    return res.status(status).render('error', { status, message });
  }
  return res.status(status).json({ error: message });
});

// --- Start -----------------------------------------------------------------
app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on http://localhost:${config.port}`);
});

module.exports = app;
