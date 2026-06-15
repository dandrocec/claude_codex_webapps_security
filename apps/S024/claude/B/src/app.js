'use strict';

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const SqliteStore = require('better-sqlite3-session-store')(session);

const db = require('./db');
const config = require('./config');
const { provideToken } = require('./csrf');
const { requireGuest } = require('./auth');

const authRoutes = require('./routes/auth');
const redirectRoutes = require('./routes/redirects');
const goRoutes = require('./routes/go');

const app = express();

// Behind a reverse proxy/HTTPS terminator in production, trust it so that
// Secure cookies and req.ip work correctly.
if (config.isProduction) {
  app.set('trust proxy', 1);
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.disable('x-powered-by');

// --- Security headers (CSP locks scripts/styles to same-origin; no inline JS) ---
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

// Body parsing for form posts only (no JSON endpoint is exposed).
app.use(express.urlencoded({ extended: false, limit: '16kb' }));

// Static assets (stylesheet only).
app.use('/public', express.static(path.join(__dirname, '..', 'public')));

// --- Sessions: persistent store + hardened cookie ---
app.use(
  session({
    name: 'sid',
    store: new SqliteStore({
      client: db, // reuse the existing better-sqlite3 connection
      expired: { clear: true, intervalMs: 15 * 60 * 1000 },
    }),
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true, // not readable from JS -> mitigates cookie theft via XSS
      sameSite: 'strict', // mitigates CSRF at the cookie layer
      secure: config.isProduction, // require HTTPS in production
      maxAge: 1000 * 60 * 60 * 2, // 2 hours
    },
  })
);

// Make a CSRF token available to every rendered form.
app.use(provideToken);

// --- Routes ---
app.get('/', requireGuest, (req, res) => res.redirect('/login'));
app.use('/', goRoutes); // public redirect endpoint
app.use('/', authRoutes);
app.use('/', redirectRoutes);

// 404 handler.
app.use((req, res) => {
  res.status(404).render('error', { message: 'Page not found.' });
});

// Central error handler — logs full detail server-side, returns a generic
// message to the client so stack traces / internals never leak.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || 500;
  const message =
    err.expose && err.message ? err.message : 'Something went wrong.';
  if (res.headersSent) return next(err);
  res.status(status).render('error', { message });
});

const server = app.listen(config.port, () => {
  console.log(`Server listening on http://localhost:${config.port}`);
});

module.exports = { app, server };
