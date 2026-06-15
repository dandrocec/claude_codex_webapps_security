'use strict';

const path = require('node:path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');

const { isProduction, sessionSecret } = require('./config');
const { loadCurrentUser } = require('./middleware/auth');
const { csrfProtection } = require('./middleware/csrf');
const { globalLimiter } = require('./middleware/rateLimit');
const { notFound, errorHandler } = require('./middleware/errors');
const authRoutes = require('./routes/auth');
const fileRoutes = require('./routes/files');

const app = express();

// Views.
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.disable('x-powered-by');

// Behind a reverse proxy in production so Secure cookies work correctly.
if (isProduction) app.set('trust proxy', 1);

// --- Security headers -----------------------------------------------------
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
        upgradeInsecureRequests: isProduction ? [] : null,
      },
    },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  })
);

// Static assets (CSS only). Served from a directory that contains no code.
app.use(
  '/static',
  express.static(path.join(__dirname, '..', 'public'), {
    index: false,
    dotfiles: 'ignore',
    setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
  })
);

// Body parsing for urlencoded forms (multipart is handled per-route by Multer).
app.use(express.urlencoded({ extended: false, limit: '64kb' }));

// --- Sessions -------------------------------------------------------------
app.use(
  session({
    name: 'sid',
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true, // not readable from JavaScript
      secure: isProduction, // only sent over HTTPS in production
      sameSite: 'lax', // mitigates CSRF on top of the token check
      maxAge: 1000 * 60 * 60 * 8, // 8 hours
    },
  })
);

// Basic global rate limit to blunt abuse.
app.use(globalLimiter);

app.use(loadCurrentUser);
app.use(csrfProtection);

// --- Routes ---------------------------------------------------------------
app.get('/', (req, res) => {
  res.redirect(res.locals.currentUser ? '/files' : '/login');
});

app.use('/', authRoutes);
app.use('/files', fileRoutes);

app.get('/healthz', (req, res) => res.json({ status: 'ok' }));

// --- Errors ---------------------------------------------------------------
app.use(notFound);
app.use(errorHandler);

module.exports = app;
