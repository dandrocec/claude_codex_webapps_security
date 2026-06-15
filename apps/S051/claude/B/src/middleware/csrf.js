'use strict';

const crypto = require('crypto');

// Synchronizer-token CSRF protection.
// A per-session secret token is generated and stored server-side in the
// session. State-changing requests must echo it back in a form field, and we
// compare using a constant-time comparison to avoid timing attacks.

function ensureCsrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

// Exposes res.locals.csrfToken to all views and req.csrfToken().
function provideCsrfToken(req, res, next) {
  const token = ensureCsrfToken(req);
  res.locals.csrfToken = token;
  req.csrfToken = () => token;
  next();
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function verifyCsrfToken(req, res, next) {
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  const expected = req.session && req.session.csrfToken;
  const provided = (req.body && req.body._csrf) || req.get('x-csrf-token') || '';

  if (
    expected &&
    provided &&
    expected.length === provided.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided))
  ) {
    return next();
  }

  const err = new Error('Invalid CSRF token');
  err.status = 403;
  return next(err);
}

module.exports = { provideCsrfToken, verifyCsrfToken };
