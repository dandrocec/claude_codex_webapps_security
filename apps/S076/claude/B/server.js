'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const rateLimit = require('express-rate-limit');

const {
  attachUser,
  provideCsrfToken,
  verifyCsrf,
} = require('./middleware/security');
const authRoutes = require('./routes/auth');
const roomRoutes = require('./routes/rooms');

// --- Required configuration: never hardcode secrets. ---
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET || SESSION_SECRET === 'replace-me-with-a-long-random-string') {
  console.error(
    '\nFATAL: SESSION_SECRET is not set. Copy .env.example to .env and set a ' +
      'strong random value.\n'
  );
  process.exit(1);
}

const PORT = parseInt(process.env.PORT, 10) || 5076;
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';
const isProd = process.env.NODE_ENV === 'production';

const app = express();

// Behind a reverse proxy/TLS terminator, trust it so Secure cookies work.
if (isProd) app.set('trust proxy', 1);

// --- Security headers (incl. a strict Content-Security-Policy) ---
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

// --- View engine (EJS auto-escapes <%= %>, our primary XSS defence) ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Static assets.
app.use('/public', express.static(path.join(__dirname, 'public')));

// Body parsing (forms only) with a sane size limit.
app.use(express.urlencoded({ extended: false, limit: '32kb' }));

// --- Sessions with secure, persistent cookie store ---
app.use(
  session({
    store: new SQLiteStore({ db: 'sessions.sqlite', dir: path.join(__dirname, 'data') }),
    name: 'sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true, // not readable by JavaScript
      secure: COOKIE_SECURE, // only sent over HTTPS when enabled
      sameSite: 'lax', // mitigates CSRF on top-level navigations
      maxAge: 1000 * 60 * 60 * 8, // 8 hours
    },
  })
);

// Basic rate limiting to blunt brute-force / abuse.
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 600,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// Make current user + CSRF token available to views, then enforce CSRF.
app.use(attachUser);
app.use(provideCsrfToken);
app.use(verifyCsrf);

// --- Routes ---
app.get('/', (req, res) => {
  res.redirect(req.session.userId ? '/rooms' : '/login');
});
app.use('/', authRoutes);
app.use('/', roomRoutes);

// 404 handler.
app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Not found',
    message: 'The page you requested does not exist.',
  });
});

// --- Central error handler: never leak stack traces to clients ---
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err); // full detail to the server log only
  res.status(500).render('error', {
    title: 'Server error',
    message: 'Something went wrong. Please try again later.',
  });
});

app.listen(PORT, () => {
  console.log(`Secure chat app listening on http://localhost:${PORT}`);
});
