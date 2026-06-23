'use strict';

require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const SqliteStore = require('better-sqlite3-session-store')(session);

const db = require('./db');
const csrf = require('./middleware/csrf');
const authRoutes = require('./routes/auth');
const eventRoutes = require('./routes/events');
const ticketRoutes = require('./routes/tickets');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 5084;
const isProd = process.env.NODE_ENV === 'production';

// --- Secrets (read from environment, never hardcoded) ---------------------
let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  if (isProd) {
    // Fail closed in production rather than run with a weak/default secret.
    console.error('FATAL: SESSION_SECRET must be set in production.');
    process.exit(1);
  }
  sessionSecret = crypto.randomBytes(48).toString('hex');
  console.warn(
    '[warning] SESSION_SECRET not set — generated an ephemeral one for development.\n' +
      '          Sessions will be invalidated on restart. Set SESSION_SECRET in .env.'
  );
}

// Behind a reverse proxy/TLS terminator, trust it so Secure cookies work.
if (isProd) app.set('trust proxy', 1);

// --- Security headers -----------------------------------------------------
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
    // HSTS only meaningful over HTTPS; enabled in production.
    hsts: isProd,
  })
);

// --- View engine ----------------------------------------------------------
// EJS auto-escapes <%= %> output, providing context-aware HTML encoding (XSS).
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

// --- Body parsing (with sane limits) --------------------------------------
app.use(express.urlencoded({ extended: false, limit: '64kb' }));

// --- Static assets --------------------------------------------------------
app.use('/static', express.static(path.join(__dirname, '..', 'public'), {
  maxAge: isProd ? '1d' : 0,
}));

// --- Sessions -------------------------------------------------------------
const cookieSecure = process.env.COOKIE_SECURE === 'true' || isProd;
app.use(
  session({
    name: 'sid',
    store: new SqliteStore({
      client: db,
      expired: { clear: true, intervalMs: 15 * 60 * 1000 },
    }),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,        // not readable by JavaScript
      secure: cookieSecure,  // only sent over HTTPS when enabled
      sameSite: 'lax',       // mitigates CSRF for top-level navigations
      maxAge: 1000 * 60 * 60 * 2, // 2 hours
    },
  })
);

// --- CSRF + view locals ---------------------------------------------------
// Order matters: populate res.locals (so every view, including the CSRF
// failure page, can render) BEFORE rejecting bad tokens.
app.use(csrf.provideToken); // expose res.locals.csrfToken to views
app.use((req, res, next) => {
  res.locals.currentUser = req.session.userId
    ? { id: req.session.userId, email: req.session.userEmail }
    : null;
  res.locals.flash = null;
  next();
});
app.use(csrf.verifyToken); // reject mutating requests without a valid token

// --- Routes ---------------------------------------------------------------
app.get('/', (req, res) => {
  res.redirect(req.session.userId ? '/events' : '/login');
});
app.use(authRoutes);
app.use(eventRoutes);
app.use(ticketRoutes);

// --- 404 ------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Not found',
    message: 'The page you requested does not exist.',
  });
});

// --- Error handler (no stack traces leaked to clients) --------------------
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err); // full detail to server logs only
  res.status(500).render('error', {
    title: 'Something went wrong',
    message: 'An unexpected error occurred. Please try again later.',
  });
});

app.listen(PORT, () => {
  console.log(`Ticketing app listening on http://localhost:${PORT}`);
});

module.exports = app;
