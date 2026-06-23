'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const rateLimit = require('express-rate-limit');

const { init } = require('./db');
const { provideToken, verifyToken } = require('./middleware/csrf');
const authRoutes = require('./routes/auth');
const quizRoutes = require('./routes/quizzes');

const PORT = parseInt(process.env.PORT, 10) || 5075;
const isProd = process.env.NODE_ENV === 'production';

if (!process.env.SESSION_SECRET) {
  if (isProd) {
    // Never run in production without a real secret.
    console.error('FATAL: SESSION_SECRET environment variable is required.');
    process.exit(1);
  }
  console.warn('WARNING: SESSION_SECRET not set; using an insecure development default.');
}

init();

const app = express();

// Behind a reverse proxy (e.g. for HTTPS termination) trust the first hop so
// Secure cookies and rate limiting work correctly.
app.set('trust proxy', 1);

// --- Views ------------------------------------------------------------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --- Security headers -------------------------------------------------------
// Helmet sets sensible defaults including a restrictive Content-Security-Policy.
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

// --- Body parsing (limited size to mitigate abuse) --------------------------
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// --- Static assets ----------------------------------------------------------
app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

// --- Sessions with secure cookies -------------------------------------------
app.use(
  session({
    name: 'sid',
    store: new SQLiteStore({
      dir: path.join(__dirname, '..', 'data'),
      db: 'sessions.db',
    }),
    secret: process.env.SESSION_SECRET || 'insecure-dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true, // not readable by JavaScript (mitigates XSS cookie theft)
      secure: isProd, // only sent over HTTPS in production
      sameSite: 'lax', // mitigates CSRF on cross-site navigations
      maxAge: 1000 * 60 * 60 * 2, // 2 hours
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

// --- CSRF token provisioning + verification ---------------------------------
app.use(provideToken);
app.use(verifyToken);

// Expose the current user to all templates.
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});

// --- Routes -----------------------------------------------------------------
app.use(['/login', '/register'], authLimiter);
app.use('/', authRoutes);
app.use('/', quizRoutes);

// --- 404 --------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Not found',
    message: 'The page you requested does not exist.',
    status: 404,
  });
});

// --- Centralised error handler ----------------------------------------------
// Never leak stack traces or internal details to the client.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err); // full detail goes to the server log only
  if (res.headersSent) return next(err);
  res.status(500).render('error', {
    title: 'Server error',
    message: 'Something went wrong. Please try again later.',
    status: 500,
  });
});

app.listen(PORT, () => {
  console.log(`Quiz platform running at http://localhost:${PORT}`);
});

module.exports = app;
