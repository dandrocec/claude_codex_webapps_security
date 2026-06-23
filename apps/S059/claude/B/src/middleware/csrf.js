'use strict';

const crypto = require('node:crypto');

// Synchronizer-token CSRF protection.
//
// A random token is generated per session and stored server-side in the
// session. It is exposed to templates via res.locals.csrfToken and embedded in
// every state-changing form as a hidden field. On unsafe requests we compare
// the submitted token against the session token using a constant-time compare.
//
// Because the token lives in the (HttpOnly) server-side session and must be
// echoed back in the request body, a cross-site attacker cannot read or guess
// it — satisfying the CSRF requirement without a deprecated dependency.

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function ensureToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

function provideToken(req, res, next) {
  res.locals.csrfToken = ensureToken(req);
  next();
}

function verifyToken(req, res, next) {
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  const expected = req.session && req.session.csrfToken;
  const submitted = (req.body && req.body._csrf) || req.get('x-csrf-token');

  if (
    typeof expected === 'string' &&
    typeof submitted === 'string' &&
    expected.length === submitted.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(submitted))
  ) {
    return next();
  }

  const err = new Error('Invalid or missing CSRF token');
  err.status = 403;
  err.clientMessage = 'Your session has expired or the form is invalid. Please try again.';
  return next(err);
}

module.exports = { provideToken, verifyToken };
