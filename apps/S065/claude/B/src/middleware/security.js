'use strict';

const crypto = require('crypto');

/**
 * Synchroniser-token CSRF protection.
 *
 * A random token is stored in the session and must accompany every
 * state-changing request (POST/PUT/PATCH/DELETE) either as the `_csrf`
 * form field or the `x-csrf-token` header. Comparison is constant-time.
 */
function csrfProtection(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  // Expose to templates for embedding in forms.
  res.locals.csrfToken = req.session.csrfToken;

  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) {
    return next();
  }

  const submitted =
    (req.body && req.body._csrf) || req.get('x-csrf-token') || '';
  const expected = req.session.csrfToken;

  const a = Buffer.from(String(submitted));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    const err = new Error('Invalid CSRF token');
    err.status = 403;
    return next(err);
  }
  return next();
}

/** Require an authenticated session; otherwise redirect to login. */
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.redirect('/login');
  }
  next();
}

/** Populate res.locals.currentUser for templates from the session. */
function loadCurrentUser(getUserById) {
  return (req, res, next) => {
    if (req.session.userId) {
      const user = getUserById(req.session.userId);
      if (user) {
        res.locals.currentUser = { id: user.id, username: user.username };
      } else {
        // Session points at a deleted user — clear it.
        req.session.userId = null;
      }
    }
    res.locals.currentUser = res.locals.currentUser || null;
    next();
  };
}

module.exports = { csrfProtection, requireAuth, loadCurrentUser };
