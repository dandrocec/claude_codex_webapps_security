'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const { Users } = require('./models');
const {
  csrfProtection,
  loadCurrentUser,
} = require('./middleware/security');
const authRoutes = require('./routes/auth');
const questionRoutes = require('./routes/questions');

function createApp() {
  const app = express();
  const isProd = process.env.NODE_ENV === 'production';

  // Behind a reverse proxy (so Secure cookies work) when in production.
  if (isProd) app.set('trust proxy', 1);

  // Views.
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));

  // Security headers (CSP restricts sources; no inline scripts are used).
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

  // Body parsing for form submissions (urlencoded). Tight size limit.
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));

  // Static assets.
  app.use(
    '/static',
    express.static(path.join(__dirname, '..', 'public'), {
      maxAge: isProd ? '1d' : 0,
    })
  );

  // Sessions with a persistent SQLite store and hardened cookie flags.
  const dataDir = path.join(__dirname, '..', 'data');
  app.use(
    session({
      name: 'sid',
      store: new SQLiteStore({ db: 'sessions.sqlite', dir: dataDir }),
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.COOKIE_SECURE === 'true' || isProd,
        maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
      },
    })
  );

  // Basic rate limiting to blunt brute-force / abuse.
  const writeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  });
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.use(loadCurrentUser((id) => Users.findById(id)));
  app.use(csrfProtection);

  // Routes.
  app.use('/', authLimiter, authRoutes);
  app.use('/', writeLimiter, questionRoutes);

  // 404 handler.
  app.use((req, res) => {
    res.status(404).render('error', { status: 404, message: 'Page not found.' });
  });

  // Central error handler — never leak stack traces or internals to clients.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) {
      console.error(err); // server-side only
    }
    const message =
      status >= 500 ? 'Something went wrong. Please try again later.' : err.message;
    res.status(status).render('error', { status, message });
  });

  return app;
}

module.exports = createApp;
