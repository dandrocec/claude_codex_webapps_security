'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const SQLiteStore = require('connect-sqlite3')(session);

const config = require('./config');
const { loadUser } = require('./middleware/auth');
const csrf = require('./middleware/csrf');
const authRoutes = require('./routes/auth');
const expenseRoutes = require('./routes/expenses');

const app = express();

// Behind a reverse proxy (e.g. in production), trust it so Secure cookies and
// rate-limit IP detection work correctly.
if (config.isProduction) {
  app.set('trust proxy', 1);
}

// View engine — EJS escapes <%= %> output by default (context-aware HTML
// encoding), which is our primary defence against stored/reflected XSS.
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --- Security headers -------------------------------------------------------
// Helmet sets a strict Content-Security-Policy, HSTS, X-Content-Type-Options,
// frame protections, referrer policy, etc.
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

// --- Body parsing -----------------------------------------------------------
// Only urlencoded form bodies are needed; cap the size to limit abuse.
app.use(express.urlencoded({ extended: false, limit: '16kb' }));

// --- Static assets ----------------------------------------------------------
app.use(express.static(path.join(__dirname, '..', 'public')));

// --- Sessions ---------------------------------------------------------------
app.use(
  session({
    name: 'sid', // avoid leaking the implementation via the default name
    store: new SQLiteStore({
      db: 'sessions.sqlite',
      dir: path.join(__dirname, '..', 'data'),
    }),
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true, // not readable by JavaScript -> mitigates XSS cookie theft
      sameSite: 'lax', // mitigates CSRF for top-level navigations
      secure: config.isProduction, // only sent over HTTPS in production
      maxAge: 1000 * 60 * 60 * 8, // 8 hours
    },
  })
);

// --- Rate limiting ----------------------------------------------------------
// Throttle authentication attempts to slow credential stuffing / brute force.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many attempts. Please try again later.',
});

// --- Per-request context ----------------------------------------------------
app.use(loadUser); // populates req.user / res.locals.currentUser
app.use(csrf.provideToken); // exposes res.locals.csrfToken to views
app.use(csrf.verifyToken); // rejects state-changing requests without a valid token

// --- Routes -----------------------------------------------------------------
app.use(authLimiter, authRoutes);
app.use(expenseRoutes);

// --- 404 --------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).render('404');
});

// --- Central error handler --------------------------------------------------
// Never leak stack traces or internal details to the client.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // Log full details server-side only.
  // eslint-disable-next-line no-console
  console.error(err);

  const status = err.status || 500;
  const message =
    status === 403
      ? 'Your session expired or the request could not be verified. Please try again.'
      : 'Something went wrong. Please try again.';

  res.status(status);
  if (res.headersSent) return;
  res.render('error', { status, message });
});

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Expense tracker listening on http://localhost:${config.port}`);
});

module.exports = app;
