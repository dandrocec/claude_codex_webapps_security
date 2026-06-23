'use strict';

const crypto = require('crypto');

// Synchronizer-token CSRF protection.
// A per-session secret token is generated and embedded as a hidden field in
// every form (and exposed to views as res.locals.csrfToken). State-changing
// requests must echo it back; the value is compared in constant time.

function getOrCreateToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

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
  const provided = req.body && req.body._csrf;

  if (
    !expected ||
    typeof provided !== 'string' ||
    provided.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  ) {
    const err = new Error('Invalid or missing CSRF token.');
    err.status = 403;
    return next(err);
  }
  return next();
}

module.exports = { provideToken, verifyToken };
