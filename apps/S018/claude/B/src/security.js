'use strict';

const crypto = require('crypto');

/**
 * CSRF protection via the synchronizer-token pattern (OWASP A01/CSRF).
 *
 * A per-session random token is stored server-side in the session and echoed
 * into every form. State-changing requests must submit a matching token in the
 * `_csrf` body field; it is compared in constant time. Safe (read-only) methods
 * are not checked but still get a token exposed to templates.
 */
function csrfProtection(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  // Available to all views for embedding in forms.
  res.locals.csrfToken = req.session.csrfToken;

  const isStateChanging = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
  if (!isStateChanging) {
    return next();
  }

  const submitted = (req.body && req.body._csrf) || '';
  const expected = req.session.csrfToken;

  if (!submitted || !safeEqual(submitted, expected)) {
    const err = new Error('Invalid or missing CSRF token.');
    err.status = 403;
    return next(err);
  }
  return next();
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Require an authenticated session; otherwise redirect to login. */
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  return res.redirect('/login');
}

/** Redirect already-authenticated users away from login/register pages. */
function redirectIfAuthed(req, res, next) {
  if (req.session && req.session.userId) {
    return res.redirect('/dashboard');
  }
  return next();
}

module.exports = { csrfProtection, requireAuth, redirectIfAuthed };
