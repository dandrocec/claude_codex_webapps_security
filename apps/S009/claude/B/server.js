'use strict';

const crypto = require('crypto');
const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { customAlphabet } = require('nanoid');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.PORT, 10) || 5009;
const IS_PROD = process.env.NODE_ENV === 'production';

// Secrets are read from the environment. We never hardcode a secret. If one is
// not supplied we generate a strong ephemeral secret at boot (sessions will not
// survive a restart, which is acceptable for this in-memory demo). In
// production a SESSION_SECRET MUST be provided.
const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
  if (IS_PROD) {
    // Fail closed in production rather than running with an ephemeral secret.
    console.error('FATAL: SESSION_SECRET must be set in production.');
    process.exit(1);
  }
  console.warn(
    '[warn] SESSION_SECRET not set; using a randomly generated ephemeral secret.'
  );
}

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------
// Global mapping of short code -> original URL. Shared across all visitors so
// any short link resolves, but the *list* of codes shown to a user is scoped to
// their own session to avoid information disclosure (IDOR-style leakage).
const urlStore = new Map();

// URL-safe, unambiguous alphabet; 7 chars gives a very large keyspace.
const generateCode = customAlphabet(
  '23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ',
  7
);

// ---------------------------------------------------------------------------
// App + middleware
// ---------------------------------------------------------------------------
const app = express();

// Trust the first proxy hop so `secure` cookies and rate-limit IPs work when
// deployed behind a reverse proxy/load balancer.
app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Security headers (CSP, HSTS, X-Content-Type-Options, frameguard, etc.).
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: IS_PROD ? [] : null,
      },
    },
    // HSTS is only meaningful over HTTPS; enable in production.
    hsts: IS_PROD,
  })
);

// Parse only URL-encoded form bodies, with a small cap to limit abuse.
app.use(express.urlencoded({ extended: false, limit: '10kb' }));

// Static assets (stylesheet only). Served from /public.
app.use(express.static(path.join(__dirname, 'public')));

// Secure session cookies.
app.use(
  session({
    name: 'sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true, // not readable from JS -> mitigates XSS cookie theft
      sameSite: 'strict', // mitigates CSRF
      secure: IS_PROD, // only sent over HTTPS in production
      maxAge: 1000 * 60 * 60, // 1 hour
    },
  })
);

// ---------------------------------------------------------------------------
// CSRF protection (synchronizer token pattern)
// ---------------------------------------------------------------------------
// `csurf` is deprecated, so we implement the well-understood synchronizer-token
// pattern ourselves: a per-session random token is embedded in every form and
// compared (in constant time) against the submitted value on state changes.
function getCsrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

function verifyCsrf(req, res, next) {
  const expected = req.session.csrfToken;
  const provided = req.body && req.body._csrf;
  const ok =
    typeof expected === 'string' &&
    typeof provided === 'string' &&
    expected.length === provided.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
  if (!ok) {
    return res.status(403).render('error', {
      status: 403,
      message: 'Invalid or missing CSRF token. Please reload and try again.',
    });
  }
  return next();
}

// Make per-session token available to all views.
app.use((req, res, next) => {
  res.locals.csrfToken = getCsrfToken(req);
  next();
});

// Rate limit state-changing requests to blunt abuse / enumeration.
const createLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------
const MAX_URL_LENGTH = 2048;
const CODE_PATTERN = /^[A-Za-z0-9]{7}$/;

// Validate and normalise a user-supplied URL. Only absolute http(s) URLs are
// accepted; this rejects dangerous schemes such as javascript:, data:, file:.
function validateUrl(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_URL_LENGTH) return null;

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (!parsed.hostname) return null;
  return parsed.href;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.get('/', (req, res) => {
  const codes = req.session.codes || [];
  // Resolve the session's codes against the live store for display.
  const links = codes
    .filter((code) => urlStore.has(code))
    .map((code) => ({ code, url: urlStore.get(code) }));
  res.render('index', { links, error: null });
});

app.post('/shorten', createLimiter, verifyCsrf, (req, res) => {
  const url = validateUrl(req.body.url);
  if (!url) {
    const codes = req.session.codes || [];
    const links = codes
      .filter((code) => urlStore.has(code))
      .map((code) => ({ code, url: urlStore.get(code) }));
    return res.status(400).render('index', {
      links,
      error: 'Please enter a valid http:// or https:// URL.',
    });
  }

  // Generate a unique code (retry on the rare collision).
  let code;
  do {
    code = generateCode();
  } while (urlStore.has(code));

  urlStore.set(code, url);

  if (!req.session.codes) req.session.codes = [];
  req.session.codes.push(code);

  res.redirect('/');
});

// Redirect endpoint. Strict code pattern prevents path traversal / abuse.
app.get('/:code', (req, res, next) => {
  const { code } = req.params;
  if (!CODE_PATTERN.test(code)) return next(); // fall through to 404
  const url = urlStore.get(code);
  if (!url) return next();
  // 302 so links remain re-resolvable; URL already validated as http(s).
  return res.redirect(302, url);
});

// ---------------------------------------------------------------------------
// Error handling (no stack traces / internals leaked to clients)
// ---------------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).render('error', { status: 404, message: 'Not found.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err); // logged server-side only
  res.status(500).render('error', {
    status: 500,
    message: 'An unexpected error occurred.',
  });
});

app.listen(PORT, () => {
  console.log(`URL shortener listening on http://localhost:${PORT}`);
});

module.exports = app;
