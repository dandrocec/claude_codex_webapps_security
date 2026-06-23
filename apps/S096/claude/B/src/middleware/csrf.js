'use strict';

const crypto = require('crypto');

// Synchronizer-token CSRF protection. A per-session secret is generated and must
// be echoed back on every state-changing request (via the _csrf form field or
// the X-CSRF-Token header). Tokens are compared with a constant-time function.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function ensureToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function csrf(req, res, next) {
  const token = ensureToken(req);
  // Expose to views so forms can embed it.
  res.locals.csrfToken = token;

  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  const provided =
    (req.body && req.body._csrf) ||
    req.get('x-csrf-token') ||
    req.get('x-xsrf-token');

  if (!safeEqual(provided, token)) {
    const err = new Error('Invalid or missing CSRF token.');
    err.status = 403;
    err.expose = true;
    return next(err);
  }
  return next();
}

module.exports = csrf;
