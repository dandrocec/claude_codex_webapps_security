'use strict';

require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);

const { loadUser } = require('./lib/auth');
const csrf = require('./lib/csrf');
const authRoutes = require('./routes/auth');
const campaignRoutes = require('./routes/campaigns');

const app = express();
const PORT = process.env.PORT || 5069;
const isProd = process.env.NODE_ENV === 'production';

// In production a real secret is mandatory; in dev fall back to an ephemeral one.
let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  if (isProd) {
    console.error('FATAL: SESSION_SECRET must be set in production.');
    process.exit(1);
  }
  sessionSecret = crypto.randomBytes(48).toString('hex');
  console.warn('WARNING: SESSION_SECRET not set; using a temporary dev secret. Sessions reset on restart.');
}

// Behind a reverse proxy (e.g. Heroku/nginx) trust it so Secure cookies work.
if (isProd) app.set('trust proxy', 1);

// ---- Security headers (OWASP) ---------------------------------------------
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
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
      },
    },
    referrerPolicy: { policy: 'no-referrer' },
  })
);

// ---- View engine ----------------------------------------------------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ---- Body parsing & static assets -----------------------------------------
// Limit body size to reduce abuse; only urlencoded form posts are used.
app.use(express.urlencoded({ extended: false, limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

// ---- Sessions with secure cookies -----------------------------------------
app.use(
  session({
    store: new SQLiteStore({ db: 'sessions.db', dir: path.join(__dirname, 'data') }),
    name: 'sid',
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: isProd, // requires HTTPS in production
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24, // 1 day
    },
  })
);

// ---- App context middleware -----------------------------------------------
app.use(loadUser);          // populate req.user / res.locals.currentUser
app.use(csrf.provideToken); // expose CSRF token to all templates
app.use(csrf.verifyToken);  // enforce CSRF on state-changing requests

// ---- Routes ---------------------------------------------------------------
app.use('/', authRoutes);
app.use('/', campaignRoutes);

// ---- 404 ------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).render('error', { status: 404, message: 'Page not found.' });
});

// ---- Central error handler (no stack traces leaked to clients) -------------
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) {
    console.error(err); // full details to server logs only
  }
  const message =
    status === 403
      ? 'Your session expired or the request was invalid. Please try again.'
      : status < 500
      ? err.message || 'Request error.'
      : 'Something went wrong on our end.';
  res.status(status).render('error', { status, message });
});

app.listen(PORT, () => {
  console.log(`Crowdfund running at http://localhost:${PORT}`);
});
