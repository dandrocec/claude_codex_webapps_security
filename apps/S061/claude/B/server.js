'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');

const models = require('./models');
const { loadUser, csrfProtection } = require('./middleware');
const authRoutes = require('./routes/auth');
const courseRoutes = require('./routes/courses');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 5061;
const isProd = process.env.NODE_ENV === 'production';

if (!process.env.SESSION_SECRET) {
  // Fail fast rather than silently signing sessions with a guessable key.
  console.error('FATAL: SESSION_SECRET is not set. Copy .env.example to .env and set it.');
  process.exit(1);
}

// Behind a reverse proxy in production so Secure cookies work over forwarded HTTPS.
if (isProd) app.set('trust proxy', 1);

/* ----------------------------- View engine ----------------------------- */
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

/* ---------------------------- Security headers -------------------------- */
// Helmet sets sensible secure defaults incl. a strict Content-Security-Policy.
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
  })
);

/* ------------------------------- Parsers -------------------------------- */
// Only urlencoded form bodies are accepted; cap the size to blunt abuse.
app.use(express.urlencoded({ extended: false, limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public')));

/* ------------------------------- Sessions ------------------------------- */
app.use(
  session({
    store: new SQLiteStore({ db: 'sessions.sqlite', dir: path.join(__dirname, 'data') }),
    name: 'sid',
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true, // not readable from JS — mitigates XSS cookie theft
      secure: isProd, // only sent over HTTPS in production
      sameSite: 'lax', // mitigates CSRF on top of token checks
      maxAge: 1000 * 60 * 60 * 4, // 4 hours
    },
  })
);

/* --------------------------- Per-request setup -------------------------- */
app.use(loadUser(models));
app.use(csrfProtection);

/* -------------------------------- Routes -------------------------------- */
// A modest global limiter; auth routes add a stricter one of their own.
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 600, standardHeaders: true, legacyHeaders: false }));

app.get('/', (req, res) => {
  if (!req.user) return res.render('home', { title: 'Welcome' });
  return res.redirect('/dashboard');
});

app.use('/', authRoutes);
app.use('/', courseRoutes);

/* ------------------------------ 404 handler ----------------------------- */
app.use((req, res) => {
  res.status(404).render('error', { title: 'Not found', status: 404, message: 'Page not found.' });
});

/* -------------------------- Central error handler ----------------------- */
// Never leak stack traces or internal details to the client.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', {
    title: 'Server error',
    status: 500,
    message: 'Something went wrong. Please try again later.',
  });
});

app.listen(PORT, () => {
  console.log(`E-learning app running at http://localhost:${PORT}  (NODE_ENV=${process.env.NODE_ENV || 'development'})`);
});
