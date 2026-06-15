'use strict';

require('dotenv').config();

const crypto = require('crypto');
const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const { normalizeHex, generatePalette } = require('./lib/palette');

const app = express();

const PORT = parseInt(process.env.PORT, 10) || 5007;
const IS_PROD = process.env.NODE_ENV === 'production';

// --- Secrets (never hardcoded) -------------------------------------------
// The session secret MUST come from the environment in production. For local
// dev convenience we fall back to a random per-process value (sessions reset
// on restart, which is fine for a stateless demo).
const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  (IS_PROD ? null : crypto.randomBytes(32).toString('hex'));

if (!SESSION_SECRET) {
  // Fail closed rather than running with a guessable/empty secret.
  console.error('FATAL: SESSION_SECRET is required in production.');
  process.exit(1);
}

// --- View engine ----------------------------------------------------------
// EJS auto-escapes `<%= %>` output, giving context-aware HTML encoding and
// mitigating reflected XSS for any value we echo back to the page.
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Behind a reverse proxy/TLS terminator, trust it so Secure cookies work.
if (IS_PROD) app.set('trust proxy', 1);

// --- Security headers (helmet) -------------------------------------------
// Strict CSP: no inline scripts; styles come from our own stylesheet plus a
// per-request nonce for the small amount of dynamic swatch styling.
app.use((req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
});

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`],
        imgSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer' },
  })
);

// --- Body parsing ---------------------------------------------------------
// Only urlencoded form data is expected; cap the size to limit abuse.
app.use(express.urlencoded({ extended: false, limit: '10kb' }));

// --- Sessions / secure cookies -------------------------------------------
app.use(
  session({
    name: 'sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: true, // needed so a CSRF token exists for first GET
    cookie: {
      httpOnly: true, // not readable from JS -> mitigates cookie theft via XSS
      sameSite: 'lax', // mitigates CSRF on top of the token check
      secure: IS_PROD, // only sent over HTTPS in production
      maxAge: 1000 * 60 * 60, // 1 hour
    },
  })
);

// --- Static assets --------------------------------------------------------
app.use(
  '/static',
  express.static(path.join(__dirname, 'public'), {
    maxAge: '1h',
    redirect: false,
  })
);

// --- CSRF protection (synchronizer token pattern) ------------------------
// A per-session secret token is required on every state-changing request and
// compared in constant time. Tokens are delivered to the page as a hidden
// form field and never via a readable cookie.
function getCsrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

function verifyCsrf(req, res, next) {
  const expected = req.session.csrfToken;
  const provided = typeof req.body._csrf === 'string' ? req.body._csrf : '';
  const a = Buffer.from(String(expected || ''));
  const b = Buffer.from(provided);
  if (!expected || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    const err = new Error('Invalid CSRF token');
    err.status = 403;
    err.publicMessage = 'Your session expired or the request was invalid. Please try again.';
    return next(err);
  }
  next();
}

const r5 = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

// --- Routes ---------------------------------------------------------------
app.get('/', (req, res) => {
  res.render('index', {
    csrfToken: getCsrfToken(req),
    cspNonce: res.locals.cspNonce,
    baseHex: '',
    palette: null,
    error: null,
  });
});

app.post('/palette', r5, verifyCsrf, (req, res, next) => {
  try {
    const normalized = normalizeHex(req.body.hex);
    if (!normalized) {
      return res.status(400).render('index', {
        csrfToken: getCsrfToken(req),
        cspNonce: res.locals.cspNonce,
        baseHex: typeof req.body.hex === 'string' ? req.body.hex.slice(0, 7) : '',
        palette: null,
        error: 'Please enter a valid hex colour such as #3366ff or #36f.',
      });
    }

    const palette = generatePalette(normalized);
    res.render('index', {
      csrfToken: getCsrfToken(req),
      cspNonce: res.locals.cspNonce,
      baseHex: normalized,
      palette,
      error: null,
    });
  } catch (err) {
    next(err);
  }
});

// --- 404 ------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).render('error', { status: 404, message: 'Page not found.' });
});

// --- Central error handler -----------------------------------------------
// Never leak stack traces or internal details to the client. Log server-side,
// respond with a safe, generic message.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  console.error(`[${new Date().toISOString()}] ${status} ${req.method} ${req.originalUrl}:`, err);
  const message =
    err.publicMessage || (status < 500 ? 'Bad request.' : 'Something went wrong. Please try again later.');
  res.status(status).render('error', { status, message });
});

app.listen(PORT, () => {
  console.log(`Hex palette generator listening on http://localhost:${PORT}`);
});

module.exports = app;
