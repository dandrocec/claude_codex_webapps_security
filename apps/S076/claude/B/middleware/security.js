'use strict';

const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Authentication guard
// ---------------------------------------------------------------------------
// Requires a logged-in session. The user id is read ONLY from the server-side
// session, never from the request body/query — this is the foundation of
// access control and prevents a client from impersonating another user.
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  return res.redirect('/login');
}

// Populate res.locals.currentUser for templates (when present).
function attachUser(req, res, next) {
  res.locals.currentUser = req.session && req.session.userId
    ? { id: req.session.userId, username: req.session.username }
    : null;
  next();
}

// ---------------------------------------------------------------------------
// CSRF protection (synchronizer token pattern)
// ---------------------------------------------------------------------------
// A random token is stored in the server-side session and echoed into every
// form. On state-changing requests we compare the submitted token against the
// session token using a constant-time comparison.
function csrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

// Expose the token to all views as csrfToken.
function provideCsrfToken(req, res, next) {
  res.locals.csrfToken = csrfToken(req);
  next();
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Verify the CSRF token on unsafe methods.
function verifyCsrf(req, res, next) {
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) return next();

  const sessionToken = req.session && req.session.csrfToken;
  const submitted = req.body && req.body._csrf;

  if (sessionToken && submitted && safeEqual(sessionToken, submitted)) {
    return next();
  }
  return res.status(403).render('error', {
    title: 'Forbidden',
    message: 'Invalid or missing CSRF token. Please reload the page and try again.',
  });
}

module.exports = {
  requireAuth,
  attachUser,
  provideCsrfToken,
  verifyCsrf,
};
