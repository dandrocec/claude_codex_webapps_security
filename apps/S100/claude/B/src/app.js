'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const flash = require('connect-flash');

const config = require('./config');
const createSqliteStore = require('./lib/sessionStore');
const { csrfProtection } = require('./middleware/csrf');
const { loadCurrentUser } = require('./middleware/auth');

const authRoutes = require('./routes/auth');
const serviceRoutes = require('./routes/services');

const app = express();

// Behind a TLS-terminating proxy? Trust it so Secure cookies + IPs work.
if (config.trustProxy) {
  app.set('trust proxy', config.trustProxy);
}

// View engine (EJS auto-escapes <%= %>, our primary XSS defence on output).
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ---------------------------------------------------------------------------
// Security headers (Helmet) + a strict Content Security Policy.
// No inline scripts/styles are used, so we can keep CSP tight.
// ---------------------------------------------------------------------------
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"], // allows EventSource (SSE) to same origin
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: config.isProd ? [] : null,
      },
    },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer' },
    hsts: config.isProd ? { maxAge: 15552000, includeSubDomains: true } : false,
  })
);

// Static assets.
app.use(
  '/static',
  express.static(path.join(__dirname, '..', 'public'), {
    maxAge: '1h',
    dotfiles: 'ignore',
  })
);

// Body parsing with sane size limits.
app.use(express.urlencoded({ extended: false, limit: '64kb' }));
app.use(express.json({ limit: '64kb' }));

// ---------------------------------------------------------------------------
// Sessions — secure cookie configuration.
// ---------------------------------------------------------------------------
app.use(
  session({
    name: 'sid',
    secret: config.sessionSecret,
    store: createSqliteStore(session),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true, // not readable by JS — mitigates XSS cookie theft
      secure: config.cookieSecure, // only sent over HTTPS in production
      sameSite: 'lax', // CSRF defence-in-depth
      maxAge: 1000 * 60 * 60 * 8, // 8 hours
    },
  })
);

app.use(flash());
app.use(loadCurrentUser);

// Expose flash messages + defaults to all views. This runs BEFORE csrf so that
// even an error thrown by the CSRF check (which short-circuits to the error
// handler) still has res.locals.flash available when rendering the error page.
app.use((req, res, next) => {
  res.locals.flash = {
    success: req.flash('success'),
    error: req.flash('error'),
  };
  res.locals.title = 'DevOps Dashboard';
  next();
});

// CSRF protection for all routes (exposes res.locals.csrfToken to views).
app.use(csrfProtection);

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.use('/', authRoutes);
app.use('/', serviceRoutes);

// Health check.
app.get('/healthz', (req, res) => res.json({ status: 'ok' }));

// ---------------------------------------------------------------------------
// 404 + centralised error handler.
// Never leak stack traces or internal error details to the client.
// ---------------------------------------------------------------------------
app.use((req, res, next) => {
  const err = new Error('Not found');
  err.status = 404;
  err.publicMessage = 'Page not found.';
  next(err);
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  // Log full details server-side only.
  if (status >= 500) {
    // eslint-disable-next-line no-console
    console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  }
  const publicMessage =
    err.publicMessage ||
    (status === 404 ? 'Page not found.' : 'Something went wrong. Please try again.');

  if (res.headersSent) return next(err);

  // For SSE / JSON clients respond in kind; otherwise render the error page.
  if (req.accepts(['html', 'json']) === 'json') {
    return res.status(status).json({ error: publicMessage });
  }
  res.status(status).render('error', {
    title: `Error ${status}`,
    status,
    message: publicMessage,
  });
});

module.exports = app;
