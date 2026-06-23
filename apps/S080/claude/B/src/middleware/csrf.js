'use strict';

const crypto = require('crypto');

// Synchroniser-token CSRF protection.
// A per-session secret token is required on every state-changing request
// (POST/PUT/PATCH/DELETE) and compared in constant time.
function csrfProtection(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  // Expose to all templates so forms can embed it.
  res.locals.csrfToken = req.session.csrfToken;

  const stateChanging = ['POST', 'PUT', 'PATCH', 'DELETE'];
  if (!stateChanging.includes(req.method)) {
    return next();
  }

  const provided =
    (req.body && req.body._csrf) ||
    req.headers['x-csrf-token'] ||
    req.headers['csrf-token'];

  const expected = req.session.csrfToken;
  if (!provided || !safeEqual(String(provided), expected)) {
    return res.status(403).render('error', {
      title: 'Invalid CSRF token',
      message: 'Your session may have expired. Please reload the page and try again.',
    });
  }
  return next();
}

function safeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = { csrfProtection };
