'use strict';

const crypto = require('crypto');

// Synchronizer-token CSRF protection. A per-session random token is embedded as
// a hidden field in every state-changing form and compared (in constant time)
// against the value stored in the session on submit.

function getToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

// Exposes the token to all templates as `csrfToken` and as a request helper.
function provideToken(req, res, next) {
  res.locals.csrfToken = getToken(req);
  next();
}

function verifyToken(req, res, next) {
  const expected = req.session.csrfToken;
  const provided = req.body && req.body._csrf;

  if (
    typeof expected === 'string' &&
    typeof provided === 'string' &&
    expected.length === provided.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided))
  ) {
    return next();
  }

  const err = new Error('Invalid or missing CSRF token.');
  err.status = 403;
  err.expose = true; // safe, generic message — no internal detail
  return next(err);
}

module.exports = { provideToken, verifyToken };
