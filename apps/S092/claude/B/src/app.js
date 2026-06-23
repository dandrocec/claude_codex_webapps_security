'use strict';

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const SQLiteStore = require('connect-sqlite3')(session);

const { csrfProtection } = require('./middleware/csrf');
const { requireAuth } = require('./middleware/auth');

const authRoutes = require('./routes/auth');
const patientRoutes = require('./routes/patient');
const doctorRoutes = require('./routes/doctor');
const receptionRoutes = require('./routes/reception');

const app = express();

// Behind a reverse proxy (e.g. nginx) trust the first hop so secure cookies work.
app.set('trust proxy', 1);

// ----------------------------- View engine --------------------------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --------------------------- Security headers -----------------------------
// helmet sets sensible defaults (HSTS, X-Content-Type-Options, frameguard, etc.)
// plus a strict Content-Security-Policy. We avoid inline scripts entirely.
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
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' },
  })
);

// --------------------------- Body parsing ---------------------------------
// Only urlencoded form bodies are accepted; capped to limit abuse.
app.use(express.urlencoded({ extended: false, limit: '64kb' }));

// ------------------------------ Sessions ----------------------------------
const dataDir = path.dirname(process.env.DB_PATH || path.join(__dirname, '..', 'data', 'clinic.db'));
app.use(
  session({
    store: new SQLiteStore({ db: 'sessions.db', dir: dataDir }),
    name: 'clinic.sid',
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true, // not readable by JS -> mitigates XSS cookie theft
      sameSite: 'lax', // mitigates CSRF on top of the token check
      secure: String(process.env.COOKIE_SECURE).toLowerCase() === 'true', // HTTPS only
      maxAge: 1000 * 60 * 60 * 2, // 2 hours
    },
  })
);

// ------------------------------ CSRF token --------------------------------
app.use(csrfProtection);

// Expose current user to all templates.
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});

// ------------------------------- Static -----------------------------------
app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));

// ------------------------- Auth rate limiting -----------------------------
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many attempts. Please try again later.',
});
app.use(['/login', '/register'], authLimiter);

// -------------------------------- Routes ----------------------------------
app.get('/', requireAuth, (req, res) => {
  const role = req.session.user.role;
  if (role === 'patient') return res.redirect('/appointments');
  if (role === 'doctor') return res.redirect('/doctor/patients');
  if (role === 'receptionist') return res.redirect('/schedule');
  return res.redirect('/login');
});

app.use('/', authRoutes);
app.use('/', patientRoutes);
app.use('/doctor', doctorRoutes);
app.use('/schedule', receptionRoutes);

// ------------------------------ 404 + errors ------------------------------
app.use((req, res) => {
  res.status(404).render('error', { title: 'Not found', message: 'Page not found.', status: 404 });
});

// Centralised error handler: never leak stack traces or internals to clients.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err); // logged server-side only
  const status = err.status || 500;
  res.status(status).render('error', {
    title: 'Something went wrong',
    message: 'An unexpected error occurred. Please try again later.',
    status,
  });
});

module.exports = app;
