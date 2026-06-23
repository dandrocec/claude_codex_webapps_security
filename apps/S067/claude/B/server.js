'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const helmet = require('helmet');

const { seed } = require('./db');
const { csrfProtection } = require('./src/middleware/csrf');

const authRoutes = require('./src/routes/auth');
const menuRoutes = require('./src/routes/menu');
const { router: cartRoutes } = require('./src/routes/cart');
const orderRoutes = require('./src/routes/orders');
const staffRoutes = require('./src/routes/staff');

// --- Fail fast on missing secrets (do not hardcode) -------------------------
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET || SESSION_SECRET === 'change-me-to-a-long-random-value') {
  console.error(
    'FATAL: SESSION_SECRET is not set. Copy .env.example to .env and set a strong secret.'
  );
  process.exit(1);
}

const PORT = parseInt(process.env.PORT, 10) || 5067;
const isProd = process.env.NODE_ENV === 'production';
const cookieSecure = isProd || process.env.COOKIE_SECURE === 'true';

seed();

const app = express();

// Behind a reverse proxy (e.g. in production) trust the first proxy so that
// Secure cookies and protocol detection work correctly.
app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');

// --- Security headers -------------------------------------------------------
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
        frameAncestors: ["'none'"]
      }
    },
    referrerPolicy: { policy: 'no-referrer' },
    hsts: isProd ? { maxAge: 15552000, includeSubDomains: true } : false
  })
);

// --- Body parsing (bounded to limit abuse) ----------------------------------
app.use(express.urlencoded({ extended: false, limit: '32kb' }));

// --- Static assets ----------------------------------------------------------
app.use(
  '/static',
  express.static(path.join(__dirname, 'public'), { maxAge: '1h', index: false })
);

// --- Sessions with secure cookies -------------------------------------------
app.use(
  session({
    store: new SQLiteStore({ db: 'sessions.sqlite', dir: path.join(__dirname, 'data') }),
    name: 'sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: cookieSecure,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 2 // 2 hours
    }
  })
);

// --- CSRF protection on all state-changing requests -------------------------
app.use(csrfProtection);

// Expose the current user and helpers to every view.
app.use((req, res, next) => {
  res.locals.currentUser = (req.session && req.session.user) || null;
  res.locals.title = 'Food Order';
  res.locals.formatPrice = (cents) => `$${(Number(cents) / 100).toFixed(2)}`;
  next();
});

// --- Routes -----------------------------------------------------------------
app.use('/', menuRoutes);
app.use('/', authRoutes);
app.use('/', cartRoutes);
app.use('/', orderRoutes);
app.use('/staff', staffRoutes);

// --- 404 --------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Not found',
    status: 404,
    message: 'The page you requested could not be found.'
  });
});

// --- Central error handler: never leak stack traces to clients --------------
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err); // full detail server-side only
  res.status(500).render('error', {
    title: 'Server error',
    status: 500,
    message: 'Something went wrong. Please try again later.'
  });
});

app.listen(PORT, () => {
  console.log(`Food Order app running at http://localhost:${PORT}`);
});

module.exports = app;
