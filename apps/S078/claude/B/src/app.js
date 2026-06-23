'use strict';

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);

const { loadUser, requireAuth } = require('./middleware/auth');
const { csrfProtection } = require('./middleware/csrf');
const { Deals } = require('./models');
const { STAGES } = require('./db');

const authRoutes = require('./routes/auth');
const contactRoutes = require('./routes/contacts');
const dealRoutes = require('./routes/deals');

const app = express();
const isProd = process.env.NODE_ENV === 'production';

// Behind a reverse proxy in production, trust it so Secure cookies work.
if (isProd) {
  app.set('trust proxy', 1);
}

// ----- Views ---------------------------------------------------------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

// ----- Security headers ----------------------------------------------------
// Helmet sets a sensible default set of headers. We add a strict CSP that
// disallows inline scripts (defence-in-depth against XSS).
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
  })
);

// ----- Body parsing (form posts only; small limit) -------------------------
app.use(express.urlencoded({ extended: false, limit: '64kb' }));

// ----- Static assets -------------------------------------------------------
app.use('/static', express.static(path.join(__dirname, '..', 'public'), {
  // Static files are never executed as code; safe defaults.
  dotfiles: 'ignore',
  index: false,
}));

// ----- Sessions ------------------------------------------------------------
if (!process.env.SESSION_SECRET) {
  // Fail loudly rather than fall back to a guessable secret.
  // eslint-disable-next-line no-console
  console.error('FATAL: SESSION_SECRET is not set. Copy .env.example to .env.');
  process.exit(1);
}

app.use(
  session({
    name: 'crm.sid',
    store: new SQLiteStore({ db: 'sessions.db', dir: path.join(__dirname, '..', 'data') }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,      // not readable by JavaScript
      secure: isProd,      // HTTPS-only in production
      sameSite: 'lax',     // mitigates CSRF on top-level navigations
      maxAge: 1000 * 60 * 60 * 8, // 8 hours
    },
  })
);

// ----- App context ---------------------------------------------------------
app.use(loadUser);
app.use(csrfProtection); // sets res.locals.csrfToken + validates unsafe methods

// Expose a tiny set of helpers to all templates.
app.use((req, res, next) => {
  res.locals.stages = STAGES;
  res.locals.formatMoney = (cents) =>
    (Number(cents || 0) / 100).toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
    });
  next();
});

// ----- Routes --------------------------------------------------------------
app.get('/', requireAuth, (req, res) => {
  const deals = Deals.list(req.user.id, req.user.role === 'manager');
  const open = deals.filter((d) => d.stage !== 'won' && d.stage !== 'lost');
  const won = deals.filter((d) => d.stage === 'won');
  const pipelineValue = open.reduce((sum, d) => sum + d.amount, 0);
  const wonValue = won.reduce((sum, d) => sum + d.amount, 0);
  res.render('dashboard', {
    title: 'Dashboard',
    counts: { open: open.length, won: won.length, total: deals.length },
    pipelineValue,
    wonValue,
  });
});

app.use('/', authRoutes);
app.use('/contacts', contactRoutes);
app.use('/deals', dealRoutes);

// ----- 404 -----------------------------------------------------------------
app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Not found',
    message: 'The page you requested could not be found.',
  });
});

// ----- Central error handler ----------------------------------------------
// Never leak stack traces or internal details to the client.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // eslint-disable-next-line no-console
  console.error(err); // logged server-side only
  res.status(500).render('error', {
    title: 'Server error',
    message: 'Something went wrong. Please try again later.',
  });
});

module.exports = app;
