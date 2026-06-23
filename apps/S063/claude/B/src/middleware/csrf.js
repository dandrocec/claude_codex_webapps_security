'use strict';

const crypto = require('crypto');

// Synchroniser-token CSRF protection.
// A random token is stored in the server-side session and must be echoed
// back in a hidden form field on every state-changing request.
function csrf(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  // Expose to all views.
  res.locals.csrfToken = req.session.csrfToken;

  const stateChanging = req.method === 'POST' || req.method === 'PUT' ||
    req.method === 'PATCH' || req.method === 'DELETE';

  if (!stateChanging) return next();

  const sent = (req.body && req.body._csrf) || req.get('x-csrf-token') || '';
  const expected = req.session.csrfToken;

  if (!isValidToken(sent, expected)) {
    const err = new Error('Invalid or missing CSRF token');
    err.status = 403;
    err.expose = true; // safe, generic message
    return next(err);
  }
  next();
}

function isValidToken(sent, expected) {
  if (typeof sent !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(sent);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = csrf;
