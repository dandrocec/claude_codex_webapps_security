'use strict';

const crypto = require('crypto');

// --- Authentication guard -------------------------------------------------
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  return res.redirect('/login');
}

// Expose the current user (if any) to all views.
function currentUser(req, res, next) {
  res.locals.currentUser = req.session && req.session.username
    ? { id: req.session.userId, username: req.session.username }
    : null;
  next();
}

// --- CSRF protection (synchronizer token pattern) -------------------------
// A per-session secret token is generated and embedded in every form. State-
// changing requests must echo it back; we compare in constant time.
function csrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

function injectCsrf(req, res, next) {
  res.locals.csrfToken = csrfToken(req);
  next();
}

function verifyCsrf(req, res, next) {
  const expected = req.session && req.session.csrfToken;
  const provided = (req.body && req.body._csrf) || req.get('x-csrf-token');
  const ok =
    expected &&
    provided &&
    expected.length === provided.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
  if (!ok) {
    const err = new Error('Invalid or missing CSRF token.');
    err.status = 403;
    err.expose = true;
    return next(err);
  }
  return next();
}

module.exports = { requireAuth, currentUser, injectCsrf, verifyCsrf };
