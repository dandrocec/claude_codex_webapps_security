'use strict';

const crypto = require('crypto');

// Synchronizer-token CSRF protection.
//
// A per-session random token is generated and stored server-side in the
// session. It is embedded in every form as a hidden field and compared,
// using a constant-time comparison, on every state-changing request.
// Because an attacker's cross-site request cannot read the victim's session
// token, forged POSTs are rejected.

function getOrCreateToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

// Exposes res.locals.csrfToken to all views and a req.csrfToken() helper.
function provideToken(req, res, next) {
  res.locals.csrfToken = getOrCreateToken(req);
  next();
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Verifies the token on mutating verbs. Safe (read-only) methods pass through.
function verifyToken(req, res, next) {
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) {
    return next();
  }

  const sessionToken = req.session && req.session.csrfToken;
  const submitted =
    (req.body && req.body._csrf) ||
    req.get('x-csrf-token') ||
    req.get('csrf-token');

  if (sessionToken && submitted && timingSafeEqual(sessionToken, submitted)) {
    return next();
  }

  res.status(403);
  return res.render('error', {
    title: 'Request blocked',
    message: 'Invalid or missing CSRF token. Please reload the page and try again.',
  });
}

module.exports = { provideToken, verifyToken };
