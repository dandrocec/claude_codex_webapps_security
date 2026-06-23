'use strict';

require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');

const { posts } = require('./models');
const { loadCurrentUser, requireAuth } = require('./middleware/auth');
const csrf = require('./middleware/csrf');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const postRoutes = require('./routes/posts');

const app = express();
const isProd = process.env.NODE_ENV === 'production';

// --- Secrets (never hardcoded) --------------------------------------------
let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  if (isProd) {
    console.error('FATAL: SESSION_SECRET environment variable is required in production.');
    process.exit(1);
  }
  // Dev convenience only: ephemeral secret (sessions reset on restart).
  sessionSecret = crypto.randomBytes(48).toString('hex');
  console.warn('WARNING: SESSION_SECRET not set — using a temporary dev secret. ' +
    'Set SESSION_SECRET in your .env file.');
}

// Behind a proxy/load balancer, trust it so Secure cookies work over HTTPS.
if (isProd) app.set('trust proxy', 1);

// --- Views ----------------------------------------------------------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

// --- Security headers ------------------------------------------------------
// Strict CSP: only same-origin scripts/styles, no inline code, no framing.
const cspDirectives = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'"],
  imgSrc: ["'self'", 'data:'],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
};
// Only meaningful behind HTTPS; including it in dev (plain HTTP) is pointless.
if (isProd) cspDirectives.upgradeInsecureRequests = [];

app.use(helmet({
  contentSecurityPolicy: { directives: cspDirectives },
  crossOriginResourcePolicy: { policy: 'same-origin' },
  referrerPolicy: { policy: 'no-referrer' },
}));

// --- Body parsing ----------------------------------------------------------
// Only urlencoded form posts; a small limit blunts oversized-payload abuse.
app.use(express.urlencoded({ extended: false, limit: '32kb' }));

// --- Static assets ---------------------------------------------------------
app.use('/static', express.static(path.join(__dirname, '..', 'public'), {
  maxAge: isProd ? '1d' : 0,
}));

// --- Sessions --------------------------------------------------------------
// Secure cookie attributes: HttpOnly, SameSite=Lax, Secure (in production).
app.use(session({
  name: 'sid',
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24, // 1 day
  },
}));

// --- App-wide locals & middleware -----------------------------------------
app.use(loadCurrentUser);

// View locals + one-shot flash messages. Runs BEFORE csrf so that if a CSRF
// check fails, the error page still has these locals available to render.
app.use((req, res, next) => {
  res.locals.appName = 'Chirp';
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
});

app.use(csrf);

// --- Routes ----------------------------------------------------------------

// Home: the personalised feed for logged-in users, otherwise a landing page.
app.get('/', (req, res) => {
  if (!req.currentUser) {
    return res.render('landing');
  }
  res.render('feed', { posts: posts.feed.all({ uid: req.currentUser.id }) });
});

app.use(authRoutes);
app.use(userRoutes);
app.use(postRoutes);

// --- 404 -------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).render('error', { status: 404, message: 'Page not found.' });
});

// --- Centralised error handler --------------------------------------------
// Never leak stack traces or internal details to the client.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) {
    console.error(err); // full detail goes to the server log only
  }
  const message = err.expose && err.message ? err.message : 'Something went wrong.';
  res.status(status);
  if (res.headersSent) return;
  res.render('error', { status, message });
});

// --- Start -----------------------------------------------------------------
const PORT = Number(process.env.PORT) || 5063;
app.listen(PORT, () => {
  console.log(`Chirp is running at http://localhost:${PORT}`);
});

module.exports = app;
