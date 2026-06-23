'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const helmet = require('helmet');

const config = require('./config');
const { currentUser, injectCsrf, requireAuth } = require('./middleware/security');
const authRoutes = require('./routes/auth');
const { router: fileRoutes, listFiles } = require('./routes/files');
const shareRoutes = require('./routes/shares');

const app = express();

// Behind a reverse proxy in production, trust it so Secure cookies work.
app.set('trust proxy', 1);

// Views (EJS auto-escapes <%= %>, giving context-aware HTML output encoding).
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --- Security headers -----------------------------------------------------
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
    crossOriginResourcePolicy: { policy: 'same-origin' },
  })
);

// --- Body parsing (forms only; modest size limit) -------------------------
app.use(express.urlencoded({ extended: false, limit: '32kb' }));

// --- Sessions -------------------------------------------------------------
app.use(
  session({
    name: 'sid',
    store: new SQLiteStore({ db: 'sessions.db', dir: config.dataDir }),
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 8, // 8 hours
    },
  })
);

app.use(currentUser);
app.use(injectCsrf);

// Static assets (CSS only); served from a non-executable directory.
app.use('/static', express.static(path.join(__dirname, 'public')));

// --- Routes ---------------------------------------------------------------
app.get('/', requireAuth, (req, res) => {
  const files = listFiles.all(req.session.userId);
  res.render('dashboard', {
    files,
    maxMib: Math.floor(config.maxUploadBytes / (1024 * 1024)),
  });
});

app.use(authRoutes);
app.use(fileRoutes);
app.use(shareRoutes);

// --- 404 ------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).render('error', { status: 404, message: 'Page not found.' });
});

// --- Centralised error handler -------------------------------------------
// Never leak stack traces or internal details to the client.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) {
    // eslint-disable-next-line no-console
    console.error(err);
  }
  const message = err.expose && err.message ? err.message : 'Something went wrong.';
  if (res.headersSent) return;
  res.status(status).render('error', { status, message });
});

module.exports = app;
