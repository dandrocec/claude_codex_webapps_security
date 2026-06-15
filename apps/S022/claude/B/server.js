'use strict';

const crypto = require('crypto');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const { evaluate, ExpressionError } = require('./evaluator');

const PORT = Number(process.env.PORT) || 5022;
const IS_PROD = process.env.NODE_ENV === 'production';

// Secrets are read from the environment, never hardcoded. A random fallback
// is generated for local dev so the app still runs, but it changes on each
// restart (which is fine for a stateless CSRF cookie).
const COOKIE_SECRET = process.env.COOKIE_SECRET || crypto.randomBytes(32).toString('hex');
if (IS_PROD && !process.env.COOKIE_SECRET) {
  // eslint-disable-next-line no-console
  console.error('FATAL: COOKIE_SECRET must be set in production.');
  process.exit(1);
}

const CSRF_COOKIE = 'csrfToken';
const CSRF_HEADER = 'x-csrf-token';

const app = express();

// Behind a single trusted proxy at most (adjust for your infra).
app.set('trust proxy', 1);
app.disable('x-powered-by');

// --- Security headers (Helmet) incl. a strict Content-Security-Policy. -------
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        connectSrc: ["'self'"],
        imgSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer' },
  })
);

// --- Body + cookie parsing with hard size limits. ----------------------------
app.use(express.json({ limit: '2kb' }));
app.use(cookieParser(COOKIE_SECRET));

// --- Rate limiting to blunt abuse / DoS. -------------------------------------
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// --- CSRF protection (signed double-submit cookie). --------------------------
// The token lives in an HttpOnly, signed cookie. The same value is rendered
// into the page's <meta> tag server-side, and the browser echoes it back in a
// custom header on POST. A cross-site attacker can neither read the cookie nor
// set the custom header, so forged requests are rejected.
function getOrSetCsrfToken(req, res) {
  let token = req.signedCookies[CSRF_COOKIE];
  if (!token || typeof token !== 'string') {
    token = crypto.randomBytes(32).toString('hex');
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: true,
      secure: IS_PROD, // requires HTTPS in production
      sameSite: 'strict',
      signed: true,
      maxAge: 24 * 60 * 60 * 1000,
    });
  }
  return token;
}

function verifyCsrf(req, res, next) {
  const cookieToken = req.signedCookies[CSRF_COOKIE];
  const headerToken = req.get(CSRF_HEADER);
  if (
    !cookieToken ||
    !headerToken ||
    cookieToken.length !== headerToken.length ||
    !crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken))
  ) {
    return res.status(403).json({ error: 'Invalid or missing CSRF token' });
  }
  return next();
}

// --- Routes. -----------------------------------------------------------------

// Serve the HTML page with a freshly-bound CSRF token injected.
app.get('/', (req, res) => {
  const token = getOrSetCsrfToken(req, res);
  res.type('html').send(renderIndex(token));
});

// Static assets (the client script) — served with no directory traversal risk.
app.use(
  '/static',
  express.static(path.join(__dirname, 'public'), {
    index: false,
    dotfiles: 'deny',
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'),
  })
);

// The one and only API endpoint.
app.post('/calc', verifyCsrf, (req, res) => {
  const { expression } = req.body || {};

  try {
    const result = evaluate(expression);
    return res.json({ result });
  } catch (err) {
    if (err instanceof ExpressionError) {
      // Safe, user-facing validation message — no internals leaked.
      return res.status(400).json({ error: err.message });
    }
    throw err; // genuine server error -> handled below
  }
});

// 404 for anything else.
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// --- Central error handler: never leak stack traces to the client. -----------
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // eslint-disable-next-line no-console
  console.error('Unhandled error:', err);
  if (res.headersSent) {
    return next(err);
  }
  res.status(500).json({ error: 'Internal server error' });
});

function htmlEscape(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function renderIndex(csrfToken) {
  // The CSRF token is HTML-escaped before being embedded (it is hex, but we
  // escape defensively as a matter of policy).
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="csrf-token" content="${htmlEscape(csrfToken)}">
  <title>Calc API</title>
  <link rel="stylesheet" href="/static/style.css">
</head>
<body>
  <main>
    <h1>Math Evaluator</h1>
    <form id="calc-form" autocomplete="off">
      <label for="expression">Expression</label>
      <input id="expression" name="expression" type="text"
             placeholder="2 + 3 * 4" maxlength="256" required>
      <button type="submit">Evaluate</button>
    </form>
    <p id="output" role="status" aria-live="polite"></p>
  </main>
  <script src="/static/app.js"></script>
</body>
</html>`;
}

if (require.main === module) {
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Calc API listening on http://localhost:${PORT}`);
  });
}

module.exports = app;
