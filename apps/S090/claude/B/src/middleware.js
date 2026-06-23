'use strict';

const crypto = require('crypto');

/**
 * Cross-cutting middleware: CSRF protection, auth guards, and input helpers.
 */

/**
 * CSRF protection using the synchronizer-token pattern.
 *
 * A random per-session token is generated and embedded in every form. State-
 * changing requests (POST/PUT/PATCH/DELETE) must echo it back; we compare in
 * constant time. Combined with SameSite=Lax cookies this gives defence in depth.
 */
function csrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

// Exposes csrfToken() and the current user to all views.
function templateLocals(req, res, next) {
  res.locals.csrfToken = csrfToken(req);
  res.locals.currentUser = req.user || null;
  next();
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function verifyCsrf(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const expected = req.session.csrfToken;
  const provided = req.body._csrf || req.get('x-csrf-token') || '';

  const a = Buffer.from(String(expected || ''));
  const b = Buffer.from(String(provided));

  if (!expected || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    const err = new Error('Invalid CSRF token');
    err.status = 403;
    err.expose = true; // safe, generic message
    return next(err);
  }
  return next();
}

// Access-control guard: only authenticated users may proceed.
function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.redirect('/');
}

/**
 * Ensure a route param refers to the *current* user's own resource (anti-IDOR).
 * Even though our routes derive identity from the session, we defensively reject
 * any attempt to address another user's id via the URL.
 */
function requireSelf(paramName) {
  return function (req, res, next) {
    const requested = Number.parseInt(req.params[paramName], 10);
    if (!Number.isInteger(requested) || requested !== req.user.id) {
      const err = new Error('Forbidden');
      err.status = 403;
      err.expose = true;
      return next(err);
    }
    return next();
  };
}

module.exports = {
  csrfToken,
  templateLocals,
  verifyCsrf,
  requireAuth,
  requireSelf,
};
