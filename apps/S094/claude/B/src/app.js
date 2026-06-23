'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const { loadUser, requireAuth } = require('./middleware/auth');
const { csrfProtection } = require('./middleware/csrf');
const { notFound, errorHandler } = require('./middleware/errors');

const authRoutes = require('./routes/auth');
const webhookRoutes = require('./routes/webhooks');
const dashboardRoutes = require('./routes/dashboard');
const inboundRoutes = require('./routes/inbound');

const app = express();

// Behind a single trusted reverse proxy in production (for correct protocol/IP).
app.set('trust proxy', config.isProduction ? 1 : false);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');

// Security headers, including a strict Content-Security-Policy that forbids
// inline scripts/styles (defence-in-depth against XSS).
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
        upgradeInsecureRequests: config.isProduction ? [] : null,
      },
    },
    hsts: config.cookieSecure ? undefined : false,
  })
);

// Static assets (CSS only; no inline styles are used).
app.use(
  '/public',
  express.static(path.join(__dirname, '..', 'public'), {
    maxAge: '1h',
    index: false,
  })
);

// Default view locals so error/404 pages render even if a failure occurs
// before the session/CSRF middleware have populated these (e.g. inbound path).
app.use((req, res, next) => {
  res.locals.currentUser = null;
  res.locals.csrfToken = '';
  next();
});

// --- Inbound webhook ingress ---
// Mounted before session/CSRF/body parsing: it is machine-to-machine,
// authenticated by a secret token in the URL (not a session), and uses its own
// raw body parser. CSRF tokens do not apply.
app.use('/', inboundRoutes);

// Sessions with hardened cookies.
app.use(
  session({
    name: 'hub.sid',
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true, // not readable from JS
      secure: config.cookieSecure, // only sent over HTTPS when enabled
      sameSite: 'lax', // mitigates CSRF on top-level navigations
      maxAge: 1000 * 60 * 60 * 8, // 8 hours
    },
  })
);

// Form bodies only (no JSON ingestion on the authenticated app surface).
app.use(express.urlencoded({ extended: false, limit: '32kb' }));

app.use(loadUser);
app.use(csrfProtection);

// Basic rate limiting on the human-facing app.
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// Public/auth pages.
app.get('/', (req, res) => {
  res.redirect(req.user ? '/dashboard' : '/login');
});
app.use('/', authRoutes);

// Authenticated app.
app.use('/', requireAuth, webhookRoutes);
app.use('/', requireAuth, dashboardRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
