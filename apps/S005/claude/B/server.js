'use strict';

/**
 * Secure Markdown preview server.
 *
 * The single sensitive operation here is turning untrusted Markdown into HTML
 * and rendering it back to the browser. Markdown allows raw HTML, so the output
 * is run through DOMPurify before it ever reaches a response. Everything else
 * (CSP, CSRF, secure session cookies, security headers, safe error handling)
 * follows OWASP Top 10 guidance.
 */

const crypto = require('crypto');
const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { marked } = require('marked');
const { JSDOM } = require('jsdom');
const createDOMPurify = require('dompurify');

// --- Configuration (no hardcoded secrets) ----------------------------------

const PORT = parseInt(process.env.PORT, 10) || 5005;
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PROD = NODE_ENV === 'production';

// In production a secret MUST be supplied via the environment. In development
// we fall back to an ephemeral random secret so the app still runs, but
// sessions won't survive a restart (which is fine for local previewing).
let SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  if (IS_PROD) {
    console.error('FATAL: SESSION_SECRET environment variable is required in production.');
    process.exit(1);
  }
  SESSION_SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('WARNING: SESSION_SECRET not set; using a temporary development secret.');
}

// Limit the size of submitted Markdown to keep rendering bounded.
const MAX_MARKDOWN_BYTES = 100 * 1024; // 100 KB

// --- HTML sanitiser ---------------------------------------------------------

const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

// Configure marked: do not allow arbitrary HTML pass-through to be trusted;
// DOMPurify is the real gate, but disabling deprecated/unsafe options helps.
marked.setOptions({
  gfm: true,
  breaks: false,
});

/**
 * Render untrusted Markdown to a sanitised HTML string that is safe to embed
 * directly in the page.
 */
function renderMarkdownSafely(markdownText) {
  const rawHtml = marked.parse(markdownText, { async: false });
  return DOMPurify.sanitize(rawHtml, {
    USE_PROFILES: { html: true },
    // Block anything that could execute or exfiltrate.
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick'],
    ALLOW_DATA_ATTR: false,
  });
}

// --- App setup --------------------------------------------------------------

const app = express();

// We sit behind no proxy by default; if deployed behind one, set TRUST_PROXY=1
// so Secure cookies and rate limiting see the real client.
if (process.env.TRUST_PROXY) {
  app.set('trust proxy', parseInt(process.env.TRUST_PROXY, 10) || 1);
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');

// Security headers, including a strict Content-Security-Policy. Styles and
// scripts are only loaded from our own origin (no inline), so injected markup
// cannot run script even if sanitisation were bypassed.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer' },
  })
);

// Parse only urlencoded form bodies, with a hard size cap.
app.use(express.urlencoded({ extended: false, limit: '256kb' }));

// Secure session cookies: HttpOnly (default), Secure in production, SameSite.
app.use(
  session({
    name: 'sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: true, // needed so a CSRF token exists before login-like flows
    cookie: {
      httpOnly: true,
      secure: IS_PROD, // requires HTTPS in production
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60, // 1 hour
    },
  })
);

// Basic rate limiting to blunt abuse of the render endpoint.
const renderLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(express.static(path.join(__dirname, 'public')));

// --- CSRF protection (synchronizer token pattern) ---------------------------

/** Return the session's CSRF token, creating one on first use. */
function getCsrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

/** Constant-time comparison to validate a submitted token. */
function isValidCsrf(req) {
  const expected = req.session.csrfToken;
  const provided = req.body && req.body._csrf;
  if (!expected || typeof provided !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requireCsrf(req, res, next) {
  if (!isValidCsrf(req)) {
    return res.status(403).render('index', {
      csrfToken: getCsrfToken(req),
      markdown: '',
      renderedHtml: null,
      error: 'Invalid or missing security token. Please reload the page and try again.',
    });
  }
  next();
}

// --- Routes -----------------------------------------------------------------

app.get('/', (req, res) => {
  res.render('index', {
    csrfToken: getCsrfToken(req),
    markdown: '',
    renderedHtml: null,
    error: null,
  });
});

app.post('/render', renderLimiter, requireCsrf, (req, res) => {
  const markdown = typeof req.body.markdown === 'string' ? req.body.markdown : '';

  if (Buffer.byteLength(markdown, 'utf8') > MAX_MARKDOWN_BYTES) {
    return res.status(413).render('index', {
      csrfToken: getCsrfToken(req),
      markdown: '',
      renderedHtml: null,
      error: 'Input too large. Please submit at most 100 KB of Markdown.',
    });
  }

  let renderedHtml = '';
  try {
    renderedHtml = renderMarkdownSafely(markdown);
  } catch (err) {
    // Never leak internals to the client; log server-side only.
    console.error('Markdown render error:', err);
    return res.status(500).render('index', {
      csrfToken: getCsrfToken(req),
      markdown,
      renderedHtml: null,
      error: 'Sorry, the Markdown could not be rendered.',
    });
  }

  res.render('index', {
    csrfToken: getCsrfToken(req),
    markdown, // re-displayed in a textarea; EJS escapes it
    renderedHtml, // already sanitised; embedded unescaped
    error: null,
  });
});

// --- Error handling (no stack traces to clients) ----------------------------

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).render('index', {
    csrfToken: req.session ? getCsrfToken(req) : '',
    markdown: '',
    renderedHtml: null,
    error: 'An unexpected error occurred.',
  });
});

app.listen(PORT, () => {
  console.log(`Markdown preview app listening on http://localhost:${PORT} (${NODE_ENV})`);
});

module.exports = app;
