'use strict';

const crypto = require('node:crypto');

// Synchroniser-token CSRF protection.
//
// A random token is stored in the (signed, server-side) session and echoed
// into every form as a hidden field. State-changing requests must present a
// token that matches the session value. Because an attacker's cross-site form
// cannot read the victim's session token, forged POSTs are rejected.

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function ensureToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function csrfProtection(req, res, next) {
  // Make the token available to all templates.
  res.locals.csrfToken = ensureToken(req);

  if (SAFE_METHODS.has(req.method)) return next();

  // Token may arrive in the parsed body (urlencoded forms), in the query
  // string (the multipart upload form, whose body is not parsed until Multer
  // runs in the route handler), or in a header (programmatic clients).
  const submitted =
    (req.body && req.body._csrf) ||
    (req.query && req.query._csrf) ||
    req.get('x-csrf-token') ||
    req.get('x-xsrf-token');

  if (!submitted || !timingSafeEqual(submitted, req.session.csrfToken)) {
    return res.status(403).render('error', {
      title: 'Request blocked',
      message: 'Invalid or missing security token. Please reload and try again.',
      status: 403,
    });
  }
  next();
}

module.exports = { csrfProtection };
