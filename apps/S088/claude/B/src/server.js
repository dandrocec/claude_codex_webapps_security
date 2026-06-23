'use strict';

require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const MemoryStore = require('memorystore')(session);

const { loadUser } = require('./middleware');
const { csrfProtection, consumeFlash } = require('./security');

const authRoutes = require('./routes/auth');
const folderRoutes = require('./routes/folders');
const documentRoutes = require('./routes/documents');
const groupRoutes = require('./routes/groups');

const app = express();
const PORT = Number(process.env.PORT) || 5088;
const isProd = process.env.NODE_ENV === 'production';

// Behind a reverse proxy (e.g. nginx) this lets secure cookies work over TLS.
app.set('trust proxy', 1);

// ---- Secrets: read from the environment; never hardcoded -------------------
let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  if (isProd) {
    // Refuse to run in production without a configured secret.
    console.error('FATAL: SESSION_SECRET must be set in production.');
    process.exit(1);
  }
  sessionSecret = crypto.randomBytes(48).toString('hex');
  console.warn(
    '[warn] SESSION_SECRET not set; using an ephemeral one. Sessions will not\n' +
    '       survive a restart. Set SESSION_SECRET in .env for stable sessions.'
  );
}

// ---- Security headers ------------------------------------------------------
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

// ---- View engine -----------------------------------------------------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ---- Static assets (CSS only). Uploads are NEVER served from here. ---------
app.use(
  '/public',
  express.static(path.join(__dirname, '..', 'public'), {
    dotfiles: 'ignore',
    index: false,
    setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
  })
);

// ---- Body parsing (forms). Bounded to limit abuse. -------------------------
app.use(express.urlencoded({ extended: false, limit: '64kb' }));

// ---- Sessions with hardened cookies ---------------------------------------
app.use(
  session({
    name: 'docman.sid',
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    store: new MemoryStore({ checkPeriod: 24 * 60 * 60 * 1000 }),
    cookie: {
      httpOnly: true, // not readable by JavaScript
      sameSite: 'lax', // mitigates CSRF on cross-site navigations
      secure: process.env.COOKIE_SECURE === 'true' || isProd, // HTTPS-only when enabled
      maxAge: 1000 * 60 * 60 * 8, // 8 hours
    },
  })
);

app.use(loadUser);
app.use(consumeFlash);
app.use(csrfProtection); // applies token to all responses; verifies on writes

// ---- Routes ----------------------------------------------------------------
app.use('/', authRoutes);
app.use('/', folderRoutes);
app.use('/', documentRoutes);
app.use('/', groupRoutes);

// ---- 404 -------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).render('error', { status: 404, message: 'Page not found.' });
});

// ---- Central error handler: never leak stack traces to clients ------------
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[error]', err && err.stack ? err.stack : err);
  const status = err && err.status ? err.status : 500;
  if (res.headersSent) return;
  res.status(status).render('error', {
    status,
    message: isProd
      ? 'Something went wrong. Please try again later.'
      : 'Something went wrong. (Details are in the server log.)',
  });
});

app.listen(PORT, () => {
  console.log(`DocMan running at http://localhost:${PORT}`);
});

module.exports = app;
