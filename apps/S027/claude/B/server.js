'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const rateLimit = require('express-rate-limit');

const { locals } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const taskRoutes = require('./routes/tasks');

const app = express();

const PORT = process.env.PORT || 5027;
const isProd = process.env.NODE_ENV === 'production';

// Fail fast if the session secret is missing — never hardcode it.
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  console.error(
    'FATAL: SESSION_SECRET is not set. Copy .env.example to .env and set a strong secret.'
  );
  process.exit(1);
}

// Behind a reverse proxy (needed for Secure cookies to work over TLS termination).
if (isProd) app.set('trust proxy', 1);

// --- Security headers ------------------------------------------------------
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
  })
);

// --- Body parsing ----------------------------------------------------------
// Limit body size to reduce abuse; only urlencoded forms are used.
app.use(express.urlencoded({ extended: false, limit: '16kb' }));

// --- Views -----------------------------------------------------------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --- Static assets ---------------------------------------------------------
app.use(
  '/static',
  express.static(path.join(__dirname, 'public'), {
    maxAge: isProd ? '1d' : 0,
  })
);

// --- Sessions --------------------------------------------------------------
app.use(
  session({
    store: new SQLiteStore({
      db: 'sessions.db',
      dir: path.join(__dirname, 'data'),
    }),
    name: 'sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true, // not readable by JS — mitigates XSS cookie theft
      secure: isProd, // only over HTTPS in production
      sameSite: 'lax', // mitigates CSRF
      maxAge: 1000 * 60 * 60 * 2, // 2 hours
    },
  })
);

// Expose currentUser + csrfToken to every view.
app.use(locals);

// --- Rate limiting on auth endpoints --------------------------------------
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many attempts. Please try again later.',
});
app.use(['/login', '/register'], authLimiter);

// --- Routes ----------------------------------------------------------------
app.get('/', (req, res) => {
  res.redirect(req.session.userId ? '/tasks' : '/login');
});

app.use('/', authRoutes);
app.use('/', taskRoutes);

// --- 404 -------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).render('error', {
    statusCode: 404,
    message: 'Page not found.',
  });
});

// --- Central error handler -------------------------------------------------
// Never leak stack traces or internal details to the client.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', {
    statusCode: 500,
    message: 'Something went wrong. Please try again later.',
  });
});

app.listen(PORT, () => {
  console.log(`Secure to-do app listening on http://localhost:${PORT}`);
});
