'use strict';

const crypto = require('crypto');

// Synchronizer-token CSRF protection.
// A random token is generated per session and required on every state-changing
// request. We compare with a constant-time comparison to avoid timing attacks.

function getToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

// Expose the token to templates as res.locals.csrfToken.
function provideToken(req, res, next) {
  res.locals.csrfToken = getToken(req);
  next();
}

// Reject unsafe requests that don't carry a valid token.
function verifyToken(req, res, next) {
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) return next();

  const expected = req.session.csrfToken;
  const supplied = req.body && req.body._csrf;

  if (
    !expected ||
    typeof supplied !== 'string' ||
    supplied.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  ) {
    const err = new Error('Invalid CSRF token');
    err.status = 403;
    return next(err);
  }
  return next();
}

module.exports = { provideToken, verifyToken };
