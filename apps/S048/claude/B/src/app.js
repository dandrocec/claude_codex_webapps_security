'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const rateLimit = require('express-rate-limit');

const { provideToken, verifyToken } = require('./middleware/csrf');
const { currentUser } = require('./middleware/auth');

const feedbackRoutes = require('./routes/feedback');
const authRoutes = require('./routes/auth');
const reviewerRoutes = require('./routes/reviewer');

const app = express();
const isProduction = process.env.NODE_ENV === 'production';

const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET || SESSION_SECRET === 'change-me-to-a-long-random-string') {
  if (isProduction) {
    console.error('SESSION_SECRET must be set to a strong value in production.');
    process.exit(1);
  } else {
    console.warn('WARNING: using a default SESSION_SECRET. Set one in .env.');
  }
}

// Behind a reverse proxy in production we need this so secure cookies work.
if (isProduction) {
  app.set('trust proxy', 1);
}

// --- Security headers (OWASP A05) -----------------------------------------
// Helmet sets sensible defaults; we add an explicit, strict CSP. No inline
// scripts are used anywhere, so 'unsafe-inline' is not needed for scripts.
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

// --- View engine ----------------------------------------------------------
// EJS auto-escapes <%= %>, giving context-aware output encoding against XSS.
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --- Body parsing ---------------------------------------------------------
app.use(express.urlencoded({ extended: false, limit: '32kb' }));

// --- Static assets --------------------------------------------------------
app.use(express.static(path.join(__dirname, '..', 'public')));

// --- Sessions (OWASP A07 / secure cookies) --------------------------------
app.use(
  session({
    store: new SQLiteStore({
      dir: path.join(__dirname, '..'),
      db: 'sessions.sqlite',
    }),
    name: 'sid',
    secret: SESSION_SECRET || 'insecure-dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true, // not readable by JavaScript
      secure: isProduction, // only sent over HTTPS in production
      sameSite: 'strict', // mitigates CSRF
      maxAge: 1000 * 60 * 60 * 2, // 2 hours
    },
  })
);

// --- Rate limiting on login (brute-force protection) ----------------------
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many login attempts. Please try again later.',
});

// --- CSRF + current-user locals -------------------------------------------
app.use(provideToken);
app.use(verifyToken); // rejects state-changing requests without a valid token
app.use(currentUser);

// --- Routes ---------------------------------------------------------------
app.use('/', feedbackRoutes);
app.use('/', (req, res, next) => {
  // Apply the login limiter only to the login POST.
  if (req.method === 'POST' && req.path === '/login') {
    return loginLimiter(req, res, next);
  }
  return next();
});
app.use('/', authRoutes);
app.use('/', reviewerRoutes);

// --- 404 ------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).render('error', { status: 404, message: 'Page not found.' });
});

// --- Central error handler (OWASP A09) ------------------------------------
// Logs full detail server-side; never leaks stack traces to the client.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) {
    console.error(err);
  }
  const safeMessage =
    status === 403
      ? 'Request rejected. Please reload the page and try again.'
      : status < 500
      ? err.message
      : 'Something went wrong. Please try again later.';
  res.status(status).render('error', { status, message: safeMessage });
});

const PORT = Number(process.env.PORT) || 5048;
app.listen(PORT, () => {
  console.log(`Feedback portal running at http://localhost:${PORT}`);
});

module.exports = app;
