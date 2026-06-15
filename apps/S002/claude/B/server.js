'use strict';

require('dotenv').config();

const crypto = require('crypto');
const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');

const app = express();

const PORT = parseInt(process.env.PORT, 10) || 5002;
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = NODE_ENV === 'production';

// --- Secrets: never hardcode; read from the environment. -------------------
// In production a missing secret is fatal. In development we generate an
// ephemeral one so the app stays runnable, but log a clear warning.
let SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  if (IS_PRODUCTION) {
    // eslint-disable-next-line no-console
    console.error('FATAL: SESSION_SECRET is not set. Refusing to start in production.');
    process.exit(1);
  }
  SESSION_SECRET = crypto.randomBytes(32).toString('hex');
  // eslint-disable-next-line no-console
  console.warn('WARNING: SESSION_SECRET not set; using a temporary development secret.');
}

// --- View engine: EJS auto-escapes <%= %>, giving context-aware output ------
// encoding to prevent reflected XSS of user-supplied values.
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Behind a reverse proxy/TLS terminator, trust it so Secure cookies work.
if (IS_PRODUCTION) {
  app.set('trust proxy', 1);
}

// --- Security headers (OWASP A05: Security Misconfiguration). ---------------
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        // No inline scripts are used; lock scripts down to same-origin only.
        'script-src': ["'self'"],
        'style-src': ["'self'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        'frame-ancestors': ["'none'"],
        'object-src': ["'none'"],
      },
    },
    referrerPolicy: { policy: 'no-referrer' },
  })
);

// Parse only URL-encoded form bodies, with a tight size limit to blunt abuse.
app.use(express.urlencoded({ extended: false, limit: '10kb' }));

// Serve static assets (CSS) from /public.
app.use(express.static(path.join(__dirname, 'public')));

// --- Secure session cookies (OWASP A07). -----------------------------------
app.use(
  session({
    name: 'sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: true, // needed so a CSRF token exists before first POST
    cookie: {
      httpOnly: true, // not readable from JavaScript
      secure: IS_PRODUCTION, // only sent over HTTPS in production
      sameSite: 'lax', // mitigates CSRF on top of the token check
      maxAge: 1000 * 60 * 30, // 30 minutes
    },
  })
);

// --- CSRF protection (OWASP A01). ------------------------------------------
// The `csurf` package is deprecated, so we implement the synchroniser-token
// pattern: a per-session random token embedded in every form and verified on
// each state-changing (POST) request using a constant-time comparison.
function getCsrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

function verifyCsrf(req, res, next) {
  const expected = req.session.csrfToken;
  const provided = typeof req.body._csrf === 'string' ? req.body._csrf : '';
  const expectedBuf = Buffer.from(expected || '', 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');
  if (
    !expected ||
    expectedBuf.length !== providedBuf.length ||
    !crypto.timingSafeEqual(expectedBuf, providedBuf)
  ) {
    return res.status(403).render('error', {
      status: 403,
      message: 'Invalid or missing CSRF token. Please reload the form and try again.',
    });
  }
  return next();
}

// --- Domain logic ----------------------------------------------------------
function classifyBmi(bmi) {
  if (bmi < 18.5) return 'Underweight';
  if (bmi < 25) return 'Normal';
  if (bmi < 30) return 'Overweight';
  return 'Obese';
}

// Validate and coerce a single numeric field within an inclusive range.
function parseMeasurement(raw, { min, max }) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  // Reject anything that is not a plain decimal number.
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < min || value > max) return null;
  return value;
}

// --- Routes ----------------------------------------------------------------
app.get('/', (req, res) => {
  res.render('index', { csrfToken: getCsrfToken(req), result: null, errors: [] });
});

app.post('/bmi', verifyCsrf, (req, res) => {
  const errors = [];

  const height = parseMeasurement(req.body.height, { min: 50, max: 300 });
  if (height === null) {
    errors.push('Height must be a number between 50 and 300 cm.');
  }

  const weight = parseMeasurement(req.body.weight, { min: 2, max: 500 });
  if (weight === null) {
    errors.push('Weight must be a number between 2 and 500 kg.');
  }

  if (errors.length > 0) {
    return res.status(400).render('index', {
      csrfToken: getCsrfToken(req),
      result: null,
      errors,
    });
  }

  const heightMeters = height / 100;
  const bmi = weight / (heightMeters * heightMeters);
  const rounded = Math.round(bmi * 10) / 10;

  return res.render('index', {
    csrfToken: getCsrfToken(req),
    result: { bmi: rounded.toFixed(1), category: classifyBmi(bmi) },
    errors: [],
  });
});

// --- Error handling: never leak stack traces or internals to clients. ------
app.use((req, res) => {
  res.status(404).render('error', { status: 404, message: 'Page not found.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // Log full detail server-side only.
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).render('error', {
    status: 500,
    message: 'An unexpected error occurred. Please try again later.',
  });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`BMI calculator listening on http://localhost:${PORT}`);
});
