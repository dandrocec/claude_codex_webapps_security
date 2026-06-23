'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');

const config = require('./config');
const csrf = require('./middleware/csrf');
const { loadUser } = require('./middleware/auth');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth');
const keysRoutes = require('./routes/keys');
const dashboardRoutes = require('./routes/dashboard');
const gatewayRoutes = require('./routes/gateway');

const app = express();

// We sit behind a proxy in most deployments; trust it for secure cookies and req.ip.
app.set('trust proxy', 1);

// View engine with automatic, context-aware HTML escaping (XSS defence).
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

// --- Security headers (OWASP) ---
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
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
  })
);

// --- API gateway (API-key authenticated, no cookies/CSRF) ---
// Mounted before the browser session/body middleware so request bodies are
// forwarded untouched.
app.use('/gateway', gatewayRoutes);

// --- Browser application (session + CSRF protected) ---
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

app.use(
  session({
    name: 'sid',
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true, // not readable from JS
      secure: config.cookieSecure, // only over HTTPS when enabled
      sameSite: 'lax', // CSRF defence-in-depth
      maxAge: 1000 * 60 * 60 * 8, // 8 hours
    },
  })
);

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(loadUser);
app.use(csrf);

app.get('/', (req, res) => {
  res.redirect(req.user ? '/dashboard' : '/login');
});

app.use('/', authRoutes);
app.use('/', dashboardRoutes);
app.use('/keys', keysRoutes);

// 404 + central error handler (no stack traces leak to clients).
app.use(notFound);
app.use(errorHandler);

module.exports = app;
