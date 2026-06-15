'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const rateLimit = require('express-rate-limit');

const { csrf, exposeUser } = require('./middleware');
const authRoutes = require('./routes/auth');
const surveyRoutes = require('./routes/surveys');
const publicRoutes = require('./routes/public');

const PORT = Number(process.env.PORT) || 5055;
const isProd = process.env.NODE_ENV === 'production';

if (!process.env.SESSION_SECRET) {
  console.error(
    'FATAL: SESSION_SECRET is not set. Copy .env.example to .env and set a strong secret.'
  );
  process.exit(1);
}

const app = express();

// Behind a reverse proxy in production so Secure cookies work correctly.
if (isProd) {
  app.set('trust proxy', 1);
}

// --- View engine -----------------------------------------------------------
// EJS auto-escapes <%= %>, giving context-aware output encoding for XSS defense.
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --- Security headers -------------------------------------------------------
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

// --- Body parsing -----------------------------------------------------------
// Reasonable size limit to blunt oversized-payload abuse.
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

// --- Static assets ----------------------------------------------------------
app.use(
  '/static',
  express.static(path.join(__dirname, 'public'), {
    dotfiles: 'ignore',
    index: false,
    maxAge: '1h',
  })
);

// --- Sessions ---------------------------------------------------------------
app.use(
  session({
    store: new SQLiteStore({
      db: 'sessions.db',
      dir: path.join(__dirname, 'data'),
    }),
    name: 'sid',
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true, // not readable by JS -> mitigates XSS cookie theft
      secure: isProd, // only sent over HTTPS in production
      sameSite: 'lax', // mitigates CSRF on top-level navigations
      maxAge: 1000 * 60 * 60 * 2, // 2 hours
    },
  })
);

// --- Global rate limiter ----------------------------------------------------
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// --- CSRF + user context ----------------------------------------------------
app.use(csrf);
app.use(exposeUser);

// --- Routes -----------------------------------------------------------------
app.get('/', (req, res) => {
  if (req.session.userId) return res.redirect('/surveys');
  return res.redirect('/login');
});

app.use(authRoutes);
app.use(publicRoutes); // public response link: /s/:token
app.use('/surveys', surveyRoutes);

// --- 404 --------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Not found',
    message: 'The page you requested does not exist.',
  });
});

// --- Central error handler --------------------------------------------------
// Logs full detail server-side; never leaks stack traces to the client.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', {
    title: 'Something went wrong',
    message: 'An unexpected error occurred. Please try again later.',
  });
});

app.listen(PORT, () => {
  console.log(`Survey builder running at http://localhost:${PORT}`);
});
