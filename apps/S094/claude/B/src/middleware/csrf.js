'use strict';

const crypto = require('crypto');

// Synchroniser-token CSRF protection. A per-session secret token is generated
// and embedded in every form; state-changing requests must echo it back. We
// compare with a constant-time check.

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function ensureToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

function csrfProtection(req, res, next) {
  // Make the token available to all views.
  const token = ensureToken(req);
  res.locals.csrfToken = token;

  if (SAFE_METHODS.has(req.method)) return next();

  const submitted =
    (req.body && req.body._csrf) ||
    req.get('x-csrf-token') ||
    req.get('x-xsrf-token') ||
    '';

  const a = Buffer.from(String(submitted));
  const b = Buffer.from(String(token));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    const err = new Error('Invalid or missing CSRF token.');
    err.status = 403;
    err.expose = true;
    return next(err);
  }
  return next();
}

module.exports = { csrfProtection };
