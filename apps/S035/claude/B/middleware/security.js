'use strict';

const crypto = require('crypto');

// ---------------------------------------------------------------------------
// CSRF protection: synchronizer-token pattern.
// A random token is stored in the session and must accompany every
// state-changing (POST) request as a hidden form field `_csrf`.
// Comparison is constant-time to avoid timing leaks.
// ---------------------------------------------------------------------------

function ensureCsrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

// Makes the token available to every view as `csrfToken`.
function csrfProvider(req, res, next) {
  res.locals.csrfToken = ensureCsrfToken(req);
  next();
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// Verifies the token on mutating requests.
function csrfProtect(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }
  const expected = req.session.csrfToken;
  const provided = req.body && req.body._csrf;
  if (!expected || !safeEqual(provided, expected)) {
    res.status(403);
    return res.render('error', {
      title: 'Forbidden',
      message: 'Invalid or missing CSRF token. Please reload and try again.',
    });
  }
  next();
}

// ---------------------------------------------------------------------------
// Authentication guard. Enforces that a user is logged in before reaching
// protected routes. Combined with per-row ownership checks in the data layer,
// this prevents broken access control / IDOR.
// ---------------------------------------------------------------------------

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  return res.redirect('/login');
}

// Redirect already-authenticated users away from login/register.
function redirectIfAuthed(req, res, next) {
  if (req.session && req.session.userId) {
    return res.redirect('/');
  }
  next();
}

module.exports = {
  csrfProvider,
  csrfProtect,
  requireAuth,
  redirectIfAuthed,
};
