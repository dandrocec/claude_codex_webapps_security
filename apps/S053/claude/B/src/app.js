'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const helmet = require('helmet');

const config = require('./config');
const { loadUser } = require('./middleware/auth');
const { provideToken, verifyToken } = require('./middleware/csrf');
const { notFound, errorHandler } = require('./middleware/errors');

const publicRoutes = require('./routes/public');
const authRoutes = require('./routes/auth');
const projectRoutes = require('./routes/projects');

const app = express();

// Behind a reverse proxy/TLS terminator, trust it so Secure cookies and
// rate-limit client IPs work correctly. Limited to one hop.
app.set('trust proxy', 1);

// Views.
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Security headers, including a strict Content-Security-Policy. We don't use
// inline scripts; styles come from our own stylesheet. Images may be remote
// (project image URLs), so img-src allows https and data.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'https:', 'data:'],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: config.cookieSecure ? [] : null,
      },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' },
  })
);

// Body parsing — forms only, with a small size limit to blunt abuse.
app.use(express.urlencoded({ extended: false, limit: '32kb' }));

// Static assets (CSS). Served read-only.
app.use(
  '/static',
  express.static(path.join(__dirname, '..', 'public'), {
    dotfiles: 'ignore',
    index: false,
    maxAge: '1h',
  })
);

// Sessions. Cookie is HttpOnly + SameSite=Lax, and Secure when COOKIE_SECURE
// is enabled (HTTPS). Backed by a SQLite store so sessions survive restarts.
app.use(
  session({
    name: 'sid',
    store: new SQLiteStore({
      dir: path.dirname(config.databasePath),
      db: 'sessions.db',
    }),
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.cookieSecure,
      maxAge: 1000 * 60 * 60 * 4, // 4 hours
    },
  })
);

// Load user, then provide + verify CSRF tokens for all routes.
app.use(loadUser);
app.use(provideToken);
app.use(verifyToken);

// Expose a couple of values to every template.
app.use((req, res, next) => {
  res.locals.appName = 'Portfolio';
  res.locals.currentYear = new Date().getFullYear();
  next();
});

// Routes.
app.use('/', publicRoutes);
app.use('/', authRoutes);
app.use('/admin', projectRoutes);

// 404 + error handling (must be last).
app.use(notFound);
app.use(errorHandler);

module.exports = app;
