'use strict';

const crypto = require('crypto');

// Synchronizer-token CSRF protection.
// A random token is stored in the (server-side) session and must be echoed back
// in a hidden form field (or X-CSRF-Token header) on every state-changing request.

function getToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

// Exposes res.locals.csrfToken to all views and a req.csrfToken() helper.
function provideToken(req, res, next) {
  res.locals.csrfToken = getToken(req);
  next();
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function verifyToken(req, res, next) {
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  const expected = req.session && req.session.csrfToken;
  const provided =
    (req.body && req.body._csrf) ||
    req.get('x-csrf-token') ||
    req.get('x-xsrf-token');

  if (
    !expected ||
    !provided ||
    typeof provided !== 'string' ||
    expected.length !== provided.length ||
    !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided))
  ) {
    const err = new Error('Invalid CSRF token');
    err.status = 403;
    err.expose = true;
    err.clientMessage = 'Form expired or invalid. Please reload and try again.';
    return next(err);
  }
  return next();
}

module.exports = { provideToken, verifyToken };
