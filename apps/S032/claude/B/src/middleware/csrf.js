'use strict';

const crypto = require('crypto');

// Synchronizer-token CSRF protection.
//
// On each session we store a random secret token. Every rendered form includes
// it in a hidden field; every state-changing request must echo it back. The
// submitted value is compared to the session value with a constant-time check.
// Because an attacker's cross-site request cannot read the victim's session
// token, it cannot forge a valid value.

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

  const sessionToken = req.session.csrfToken;
  const submitted = req.body && req.body._csrf;

  if (
    !sessionToken ||
    typeof submitted !== 'string' ||
    submitted.length !== sessionToken.length ||
    !crypto.timingSafeEqual(Buffer.from(submitted), Buffer.from(sessionToken))
  ) {
    const err = new Error('Invalid CSRF token');
    err.status = 403;
    return next(err);
  }
  return next();
}

module.exports = { provideToken, verifyToken };
