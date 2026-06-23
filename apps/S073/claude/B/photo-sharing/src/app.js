'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');

const config = require('./config');
const { loadUser } = require('./middleware/auth');
const { provideToken, verifyToken } = require('./middleware/csrf');
const flash = require('./middleware/flash');

const authRoutes = require('./routes/auth');
const feedRoutes = require('./routes/feed');
const photoRoutes = require('./routes/photos');
const userRoutes = require('./routes/users');
const fileRoutes = require('./routes/files');

// Make sure the upload directory exists and lives outside any static root.
fs.mkdirSync(config.uploadDir, { recursive: true });

const app = express();

// We only run behind a proxy in production (for correct Secure-cookie handling).
if (config.isProd) {
  app.set('trust proxy', 1);
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.disable('x-powered-by');

// ---- Security headers ----
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: config.isProd ? [] : null,
      },
    },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer' },
  })
);

// ---- Static assets (CSS only; uploads are NOT served from here) ----
app.use(
  '/static',
  express.static(path.join(__dirname, '..', 'public'), {
    dotfiles: 'ignore',
    index: false,
    redirect: false,
  })
);

// ---- Body parsing (no file fields here; multer handles multipart) ----
app.use(express.urlencoded({ extended: false, limit: '32kb' }));

// ---- Sessions with secure cookie settings ----
app.use(
  session({
    name: 'sid',
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProd, // requires HTTPS in production
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    },
  })
);

// ---- Basic rate limiting to blunt brute-force / abuse ----
const generalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, standardHeaders: true, legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 50, standardHeaders: true, legacyHeaders: false });
app.use(generalLimiter);

// ---- Per-request context ----
app.use(loadUser);
app.use(flash);
app.use(provideToken);

// Uploaded image files (own hardened handler, before CSRF since it's a safe GET).
app.use('/', fileRoutes);

// CSRF verification for all state-changing requests below.
app.use(verifyToken);

// ---- Routes ----
// Throttle only the credential endpoints (not the whole app).
app.use(['/login', '/register'], authLimiter);
app.use('/', authRoutes);
app.use('/', feedRoutes);
app.use('/', photoRoutes);
app.use('/', userRoutes);

// ---- 404 ----
app.use((req, res, next) => {
  next(Object.assign(new Error('Page not found'), { status: 404, expose: true }));
});

// ---- Centralized error handler: never leak stack traces or internals ----
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) {
    // Log full details server-side only.
    // eslint-disable-next-line no-console
    console.error(err);
  }
  const message =
    err.expose && err.clientMessage
      ? err.clientMessage
      : err.expose
      ? err.message
      : status >= 500
      ? 'Something went wrong. Please try again later.'
      : 'Request could not be processed.';

  res.status(status);
  if (req.accepts('html')) {
    res.render('error', { title: 'Error', status, message });
  } else {
    res.json({ error: message });
  }
});

module.exports = app;
