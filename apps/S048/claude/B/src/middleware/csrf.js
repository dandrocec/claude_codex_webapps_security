'use strict';

const crypto = require('crypto');

// Synchronizer-token CSRF protection.
//
// A random token is bound to the session and exposed to templates as
// `res.locals.csrfToken`. State-changing requests must echo it back in the
// `_csrf` form field (or `x-csrf-token` header). Comparison is constant-time.

function getOrCreateToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

// Make the token available to all views.
function provideToken(req, res, next) {
  res.locals.csrfToken = getOrCreateToken(req);
  next();
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function verifyToken(req, res, next) {
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  const expected = req.session.csrfToken;
  const provided =
    (req.body && req.body._csrf) ||
    req.get('x-csrf-token') ||
    '';

  const ok =
    typeof expected === 'string' &&
    typeof provided === 'string' &&
    expected.length === provided.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));

  if (!ok) {
    const err = new Error('Invalid CSRF token');
    err.status = 403;
    return next(err);
  }

  return next();
}

module.exports = { provideToken, verifyToken };
