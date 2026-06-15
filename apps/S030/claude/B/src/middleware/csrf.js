'use strict';

// Synchronizer-token CSRF protection.
//
// A random token is bound to the session. State-changing requests
// (POST/PUT/PATCH/DELETE) must echo it back in the `_csrf` field (or the
// `x-csrf-token` header). The comparison is constant-time. Because the token
// lives in the server-side session and is required on every mutating request,
// a cross-site request (which cannot read the session token) is rejected.

const crypto = require('crypto');

function getOrCreateToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

// Expose res.locals.csrfToken to all templates and accept the token from
// either the form body or a request header.
function csrfProtection(req, res, next) {
  const token = getOrCreateToken(req);
  res.locals.csrfToken = token;

  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) {
    return next();
  }

  const submitted =
    (req.body && req.body._csrf) ||
    req.get('x-csrf-token') ||
    req.get('x-xsrf-token');

  const expected = Buffer.from(token);
  const provided = Buffer.from(String(submitted || ''));

  if (
    provided.length !== expected.length ||
    !crypto.timingSafeEqual(expected, provided)
  ) {
    const err = new Error('Invalid CSRF token');
    err.status = 403;
    err.code = 'EBADCSRFTOKEN';
    return next(err);
  }

  return next();
}

module.exports = { csrfProtection };
