'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const { csrfProtection } = require('./security');
const authRoutes = require('./routes/auth');
const checkRoutes = require('./routes/checks');

const app = express();

// Behind a reverse proxy/load balancer (e.g. in production) trust the first
// hop so that "secure" cookies and client IPs work correctly.
if (config.isProduction) {
  app.set('trust proxy', 1);
}

// --- Views ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --- Security headers (OWASP A05) ---
// Helmet sets HSTS, X-Content-Type-Options, frameguard, referrer policy, etc.
// A strict Content-Security-Policy mitigates XSS by disallowing inline/3rd-party
// scripts. The app uses no inline scripts, so this does not break anything.
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
  })
);

// --- Body parsing (forms only; bounded to limit abusive payloads) ---
app.use(express.urlencoded({ extended: false, limit: '16kb' }));

// --- Static assets ---
app.use(
  '/static',
  express.static(path.join(__dirname, '..', 'public'), {
    maxAge: '1h',
    redirect: false,
  })
);

// --- Sessions with hardened cookies (OWASP A05/A07) ---
app.use(
  session({
    name: 'sid',
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true, // not readable by JS -> mitigates XSS cookie theft
      sameSite: 'strict', // mitigates CSRF
      secure: config.isProduction, // HTTPS-only in production
      maxAge: 1000 * 60 * 30, // 30 minutes
    },
  })
);

// --- CSRF protection on all state-changing requests ---
app.use(csrfProtection);

// Expose the logged-in username to all views (for the header).
app.use((req, res, next) => {
  res.locals.currentUser = req.session.username || null;
  next();
});

// Throttle brute-force attempts against auth endpoints (OWASP A07).
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many attempts. Please try again later.',
});

// --- Routes ---
app.get('/', (req, res) => {
  res.redirect(req.session.userId ? '/dashboard' : '/login');
});
app.use('/', authLimiter, authRoutes);
app.use('/', checkRoutes);

// --- 404 ---
app.use((req, res) => {
  res.status(404).render('error', { status: 404, message: 'Page not found.' });
});

// --- Central error handler: never leak stack traces/internals (OWASP A05) ---
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // Log full detail server-side only.
  // eslint-disable-next-line no-console
  console.error(err);

  const status = err.status || 500;
  // Show specific messages for client errors; a generic message for 5xx.
  const message =
    status < 500 ? err.message : 'Something went wrong. Please try again.';

  if (res.headersSent) {
    return next(err);
  }
  res.status(status).render('error', { status, message });
});

module.exports = app;
