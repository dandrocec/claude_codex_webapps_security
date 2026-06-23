'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const SQLiteStore = require('connect-sqlite3')(session);

const config = require('./config');
const { loadUser } = require('./middleware/auth');
const { provideToken, verifyToken } = require('./middleware/csrf');
const authRoutes = require('./routes/auth');
const auctionRoutes = require('./routes/auctions');

const app = express();

// Behind a reverse proxy/HTTPS terminator, trust it so Secure cookies work.
if (config.isProduction) {
  app.set('trust proxy', 1);
}

// View engine — EJS auto-escapes <%= %>, giving context-aware HTML output
// encoding against XSS.
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Security headers, including a strict Content-Security-Policy. We use an
// external stylesheet and no inline scripts, so no 'unsafe-inline' is needed.
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
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer' },
  })
);

// Body parsing. Limit size to mitigate abuse.
app.use(express.urlencoded({ extended: false, limit: '64kb' }));

// Static assets.
app.use(
  '/static',
  express.static(path.join(__dirname, 'public'), {
    maxAge: config.isProduction ? '1d' : 0,
  })
);

// Sessions with persistent SQLite store and hardened cookie settings.
app.use(
  session({
    name: 'sid',
    store: new SQLiteStore({
      dir: path.dirname(config.databaseFile),
      db: 'sessions.db',
    }),
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 8, // 8 hours
    },
  })
);

app.use(loadUser);
app.use(provideToken);
app.use(verifyToken);

// Routes.
app.use('/', authRoutes);
app.use('/', auctionRoutes);

// 404 handler.
app.use((req, res) => {
  res.status(404).render('error', { status: 404, message: 'Page not found.' });
});

// Central error handler. Logs full detail server-side; never leaks internals
// (stack traces, SQL, etc.) to the client.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) {
    console.error(err);
  }
  const message =
    status === 403
      ? 'Request blocked for security reasons.'
      : status === 404
        ? 'Not found.'
        : status < 500
          ? err.message
          : 'An unexpected error occurred.';
  res.status(status).render('error', { status, message });
});

const server = app.listen(config.port, () => {
  console.log(`Auction site listening on http://localhost:${config.port}`);
});

module.exports = { app, server };
