'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const rateLimit = require('express-rate-limit');

const cookieParser = require('./cookies');
const {
  csrfProtection,
  voterToken,
  exposeUser,
} = require('./middleware/security');
const authRoutes = require('./routes/auth');
const pollRoutes = require('./routes/polls');

// --- Fail fast on missing secrets ----------------------------------------

const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET || SESSION_SECRET === 'replace-me-with-a-long-random-string') {
  console.error(
    'FATAL: SESSION_SECRET is not set. Copy .env.example to .env and set a strong secret.'
  );
  process.exit(1);
}

const PORT = parseInt(process.env.PORT, 10) || 5043;
const isProd = process.env.NODE_ENV === 'production';
const cookieSecure = process.env.COOKIE_SECURE === 'true';

const app = express();

// Behind a reverse proxy / TLS terminator, trust it so Secure cookies work.
if (isProd) {
  app.set('trust proxy', 1);
}

// --- Views ---------------------------------------------------------------

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

// --- Security headers -----------------------------------------------------

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

// --- Global rate limit ----------------------------------------------------

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// --- Body & cookie parsing -----------------------------------------------

// Bounded body size to reduce abuse.
app.use(express.urlencoded({ extended: false, limit: '32kb' }));
app.use(cookieParser);

// --- Sessions -------------------------------------------------------------

app.use(
  session({
    store: new SQLiteStore({ db: 'sessions.sqlite', dir: path.join(__dirname, '..', 'data') }),
    name: 'connect.sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,          // not readable by JS — mitigates XSS cookie theft
      secure: cookieSecure,    // only over HTTPS in production
      sameSite: 'lax',         // CSRF defence-in-depth
      maxAge: 1000 * 60 * 60 * 8, // 8 hours
    },
  })
);

// --- App-wide middleware --------------------------------------------------

app.use(voterToken);        // anonymous voter identity (one vote per poll)
app.use(csrfProtection);    // CSRF token for all state-changing requests
app.use(exposeUser);        // res.locals.currentUser for templates

// Static assets (served with sane caching by express.static).
app.use('/static', express.static(path.join(__dirname, '..', 'public'), {
  maxAge: '1h',
}));

// --- Routes ---------------------------------------------------------------

app.use('/', authRoutes);
app.use('/', pollRoutes);

// --- 404 ------------------------------------------------------------------

app.use((req, res) => {
  res.status(404).render('404');
});

// --- Central error handler -----------------------------------------------
// Never leak stack traces or internals to the client.

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  // Log full detail server-side only.
  console.error(`[${new Date().toISOString()}] ${status} ${req.method} ${req.originalUrl}:`, err);

  const message =
    err.expose && err.message
      ? err.message
      : status === 403
        ? 'Forbidden.'
        : status === 404
          ? 'Not found.'
          : 'Something went wrong. Please try again.';

  res.status(status);
  if (req.accepts('html')) {
    res.render('error', { status, message });
  } else {
    res.json({ error: message });
  }
});

app.listen(PORT, () => {
  console.log(`Secure Polls running at http://localhost:${PORT}`);
});
