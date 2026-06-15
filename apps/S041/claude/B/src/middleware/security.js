'use strict';

const crypto = require('crypto');

// --- CSRF protection: synchronizer-token pattern ----------------------------
// We generate a per-session secret token, expose it to templates as a hidden
// field / header value, and require state-changing requests to echo it back.
// Comparison is constant-time to avoid timing oracles.

function ensureCsrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

// Makes csrfToken and the current user available to every rendered view.
function templateLocals(req, res, next) {
  res.locals.csrfToken = ensureCsrfToken(req);
  res.locals.currentUser = req.session.user || null;
  next();
}

function verifyCsrf(req, res, next) {
  const expected = req.session.csrfToken;
  const provided =
    (req.body && req.body._csrf) ||
    req.get('x-csrf-token') ||
    req.get('x-xsrf-token');

  const ok =
    typeof expected === 'string' &&
    typeof provided === 'string' &&
    expected.length === provided.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));

  if (!ok) {
    const err = new Error('Invalid CSRF token');
    err.status = 403;
    err.expose = true;
    return next(err);
  }
  return next();
}

// --- Authentication / authorization gates -----------------------------------

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.redirect('/login');
}

function redirectIfAuthed(req, res, next) {
  if (req.session && req.session.user) return res.redirect('/admin');
  return next();
}

module.exports = {
  ensureCsrfToken,
  templateLocals,
  verifyCsrf,
  requireAuth,
  redirectIfAuthed,
};
