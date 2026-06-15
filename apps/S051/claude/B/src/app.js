'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const { provideCsrfToken, verifyCsrfToken } = require('./middleware/csrf');
const authRoutes = require('./routes/auth');
const movieRoutes = require('./routes/movies');

const app = express();

const isProd = process.env.NODE_ENV === 'production';
const cookieSecure = isProd || process.env.COOKIE_SECURE === 'true';

// Behind a reverse proxy (e.g. in production) trust the first proxy so that
// Secure cookies and req.ip work correctly.
if (isProd) {
  app.set('trust proxy', 1);
}

// ---- Views -----------------------------------------------------------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

// ---- Security headers ------------------------------------------------------
// Helmet sets sensible defaults including a restrictive Content-Security-Policy
// that blocks inline scripts, mitigating XSS.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-origin' },
  })
);

// ---- Body parsing ----------------------------------------------------------
// Only urlencoded form data is needed; cap the payload size.
app.use(express.urlencoded({ extended: false, limit: '16kb' }));

// ---- Static assets ---------------------------------------------------------
app.use(
  '/static',
  express.static(path.join(__dirname, '..', 'public'), {
    maxAge: '1h',
    dotfiles: 'ignore',
  })
);

// ---- Sessions --------------------------------------------------------------
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  throw new Error(
    'SESSION_SECRET is not set. Copy .env.example to .env and set a value.'
  );
}

app.use(
  session({
    store: new SQLiteStore({
      dir: path.join(__dirname, '..', 'data'),
      db: 'sessions.sqlite',
    }),
    name: 'sid',
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true, // not readable from JavaScript
      secure: cookieSecure, // only sent over HTTPS in production
      sameSite: 'lax', // mitigates CSRF for cross-site navigations
      maxAge: 1000 * 60 * 60 * 8, // 8 hours
    },
  })
);

// ---- Expose current user to all views --------------------------------------
// Registered before CSRF so that even a rejected (403) request can render the
// shared layout, which references currentUser.
app.use((req, res, next) => {
  res.locals.currentUser = req.session.userId
    ? { id: req.session.userId, username: req.session.username }
    : null;
  next();
});

// ---- CSRF ------------------------------------------------------------------
app.use(provideCsrfToken);
app.use(verifyCsrfToken);

// ---- Rate limiting on auth endpoints --------------------------------------
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many attempts. Please try again later.',
});
app.use(['/login', '/register'], authLimiter);

// ---- Routes ----------------------------------------------------------------
app.get('/', (req, res) => {
  res.redirect(req.session.userId ? '/movies' : '/login');
});
app.use(authRoutes);
app.use(movieRoutes);

// ---- 404 -------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).render('error', { status: 404, message: 'Page not found.' });
});

// ---- Central error handler -------------------------------------------------
// Never leak stack traces or internal details to the client.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) {
    console.error(err); // logged server-side only
  }
  if (res.headersSent) {
    return next(err);
  }
  const message =
    status === 403
      ? 'Request rejected (invalid or expired form token). Please try again.'
      : status < 500
      ? err.message
      : 'Something went wrong. Please try again later.';

  res.status(status).render('error', { status, message });
});

module.exports = app;
