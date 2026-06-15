'use strict';

require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');

const app = express();

// ---------------------------------------------------------------------------
// Configuration (no secrets are hardcoded; they come from the environment).
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.PORT, 10) || 5020;
const IS_PROD = process.env.NODE_ENV === 'production';
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!SESSION_SECRET) {
  // Fail closed rather than fall back to a weak, predictable default.
  console.error(
    'FATAL: SESSION_SECRET is not set. Copy .env.example to .env and set a ' +
      'strong random value (see README).'
  );
  process.exit(1);
}

// Cap on accepted input so a huge paste cannot exhaust memory/CPU.
const MAX_JSON_BYTES = 1024 * 1024; // 1 MB

// ---------------------------------------------------------------------------
// View engine
// ---------------------------------------------------------------------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Behind a reverse proxy (e.g. for TLS termination) this lets secure cookies
// work correctly. Harmless in local development.
app.set('trust proxy', 1);

// ---------------------------------------------------------------------------
// Security headers (OWASP A05: Security Misconfiguration).
// A strict Content-Security-Policy is the primary XSS backstop; the page uses
// no inline scripts, so we can forbid them outright.
// ---------------------------------------------------------------------------
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    referrerPolicy: { policy: 'no-referrer' },
  })
);

// ---------------------------------------------------------------------------
// Body parsing — explicitly bounded.
// ---------------------------------------------------------------------------
app.use(express.urlencoded({ extended: false, limit: MAX_JSON_BYTES }));

// Static assets (CSS only). Served read-only from a dedicated folder.
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// ---------------------------------------------------------------------------
// Sessions with hardened cookie flags (OWASP A07).
//   httpOnly : not reachable from JavaScript -> mitigates token theft via XSS
//   sameSite : 'lax' blocks cross-site form posts -> CSRF defence in depth
//   secure   : only sent over HTTPS in production
// ---------------------------------------------------------------------------
app.use(
  session({
    name: 'sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: true, // needed so a CSRF token exists on first GET
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: IS_PROD,
      maxAge: 1000 * 60 * 60, // 1 hour
    },
  })
);

// ---------------------------------------------------------------------------
// CSRF protection (OWASP A01) — synchronizer-token pattern.
// A per-session random token is embedded in every form and verified with a
// constant-time comparison on every state-changing (POST) request.
// ---------------------------------------------------------------------------
function ensureCsrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

function validCsrf(req) {
  const expected = req.session.csrfToken;
  const provided = req.body && req.body._csrf;
  if (typeof expected !== 'string' || typeof provided !== 'string') {
    return false;
  }
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// JSON formatting helper.
// Returns either { ok: true, formatted } or { ok: false, error }.
// Error messages describe the problem without exposing any server internals.
// ---------------------------------------------------------------------------
function formatJson(input) {
  if (typeof input !== 'string') {
    return { ok: false, error: 'No input was received.' };
  }
  const trimmed = input.trim();
  if (trimmed === '') {
    return { ok: false, error: 'Please paste some JSON to validate.' };
  }
  if (Buffer.byteLength(trimmed, 'utf8') > MAX_JSON_BYTES) {
    return { ok: false, error: 'Input is too large (limit is 1 MB).' };
  }

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    return { ok: false, error: describeParseError(err, trimmed) };
  }
  return { ok: true, formatted: JSON.stringify(parsed, null, 2) };
}

// Turn a raw SyntaxError into a friendly, line/column-aware message.
function describeParseError(err, source) {
  const message = String(err.message || 'Invalid JSON.');
  const posMatch = message.match(/position (\d+)/i);
  if (posMatch) {
    const pos = Number(posMatch[1]);
    const upTo = source.slice(0, pos);
    const line = upTo.split('\n').length;
    const column = pos - upTo.lastIndexOf('\n');
    const reason = message.replace(/\s*in JSON at position \d+.*/i, '');
    return `${reason} (line ${line}, column ${column}).`;
  }
  return message.replace(/^JSON\.parse:?\s*/i, '');
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.get('/', (req, res) => {
  res.render('index', {
    csrfToken: ensureCsrfToken(req),
    input: '',
    formatted: null,
    error: null,
  });
});

app.post('/validate', (req, res) => {
  if (!validCsrf(req)) {
    return res.status(403).render('index', {
      csrfToken: ensureCsrfToken(req),
      input: '',
      formatted: null,
      error: 'Your session expired or the request could not be verified. ' +
        'Please try again.',
    });
  }

  const input = typeof req.body.json === 'string' ? req.body.json : '';
  const result = formatJson(input);

  res.render('index', {
    csrfToken: ensureCsrfToken(req),
    input, // re-rendered through EJS auto-escaping (XSS-safe)
    formatted: result.ok ? result.formatted : null,
    error: result.ok ? null : result.error,
  });
});

// ---------------------------------------------------------------------------
// 404 + central error handler (OWASP A09): never leak stack traces.
// ---------------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).render('error', { status: 404, message: 'Page not found.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err); // full detail to the server log only
  res
    .status(500)
    .render('error', { status: 500, message: 'Something went wrong.' });
});

app.listen(PORT, () => {
  console.log(`JSON validator running at http://localhost:${PORT}`);
});
