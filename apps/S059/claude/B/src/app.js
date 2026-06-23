'use strict';

const path = require('node:path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const flash = require('connect-flash');

const config = require('./config');
const csrf = require('./middleware/csrf');
const { exposeUser } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const bookingRoutes = require('./routes/bookings');

const app = express();

// Behind a reverse proxy / load balancer in production, trust the first hop so
// Secure cookies and rate-limiting see the real client.
if (config.isProduction) {
  app.set('trust proxy', 1);
}

// --- View engine ------------------------------------------------------------
// EJS auto-escapes <%= %> output, giving context-aware HTML output encoding to
// defend against stored/reflected XSS.
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

// Guarantee these template locals always exist so the error view can render
// even if a failure occurs before the per-request middleware below runs.
app.use((req, res, next) => {
  res.locals.currentUser = null;
  res.locals.messages = { success: [], error: [] };
  res.locals.csrfToken = '';
  next();
});

// --- Security headers -------------------------------------------------------
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        // No inline scripts; all assets are same-origin.
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'"],
        'img-src': ["'self'", 'data:'],
        'object-src': ["'none'"],
        'frame-ancestors': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
      },
    },
    // HSTS only makes sense over HTTPS (production).
    hsts: config.isProduction,
  }),
);

// --- Body parsing -----------------------------------------------------------
// Only urlencoded form bodies are accepted; small limit to blunt abuse.
app.use(express.urlencoded({ extended: false, limit: '16kb' }));

// --- Static assets ----------------------------------------------------------
app.use(
  '/static',
  express.static(path.join(__dirname, '..', 'public'), {
    maxAge: '1h',
    dotfiles: 'ignore',
  }),
);

// --- Sessions ---------------------------------------------------------------
app.use(
  session({
    name: 'sid',
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true, // not readable by JS -> mitigates token theft via XSS
      sameSite: 'lax', // blocks cross-site form posts -> CSRF defense in depth
      secure: config.isProduction, // Secure flag when served over HTTPS
      maxAge: 1000 * 60 * 60 * 8, // 8 hours
    },
  }),
);

app.use(flash());

// Expose common template locals: current user, flash messages, CSRF token.
app.use(exposeUser);
app.use((req, res, next) => {
  res.locals.messages = {
    success: req.flash('success'),
    error: req.flash('error'),
  };
  next();
});
app.use(csrf.provideToken);
// Verify the CSRF token on every state-changing (non-safe) request, app-wide.
// Safe methods (GET/HEAD/OPTIONS) pass straight through.
app.use(csrf.verifyToken);

// --- Routes -----------------------------------------------------------------
app.use('/', authRoutes);
app.use('/', bookingRoutes);

// --- 404 --------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Not found',
    status: 404,
    message: 'The page you requested does not exist.',
  });
});

// --- Central error handler --------------------------------------------------
// Never leak stack traces or internal details to the client.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) {
    // eslint-disable-next-line no-console
    console.error(err);
  }
  res.status(status).render('error', {
    title: 'Error',
    status,
    message: err.clientMessage || (status < 500 ? err.message : 'Something went wrong. Please try again.'),
  });
});

module.exports = app;
