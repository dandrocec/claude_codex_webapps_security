'use strict';

const crypto = require('crypto');

/**
 * Synchronizer-token CSRF protection.
 *
 * A random token is stored in the user's session and exposed to templates as
 * `res.locals.csrfToken`. Every state-changing request (POST/PUT/PATCH/DELETE)
 * must echo that token back via the `_csrf` form field or `x-csrf-token`
 * header. The comparison is constant-time to avoid timing attacks.
 *
 * (The popular `csurf` package is deprecated/unmaintained, so we implement the
 * same well-understood pattern directly.)
 */
function csrf(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;

  const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
  if (!mutating) {
    return next();
  }

  const sent = (req.body && req.body._csrf) || req.headers['x-csrf-token'] || '';
  const expected = req.session.csrfToken;

  const sentBuf = Buffer.from(String(sent));
  const expectedBuf = Buffer.from(String(expected));

  if (
    sentBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(sentBuf, expectedBuf)
  ) {
    const err = new Error('Invalid CSRF token');
    err.status = 403;
    return next(err);
  }

  return next();
}

/** Make the logged-in user available to all templates. */
function currentUser(req, res, next) {
  res.locals.currentUser = req.session.user || null;
  next();
}

/** Guard for routes that require authentication. */
function requireLogin(req, res, next) {
  if (!req.session.user) {
    req.session.flash = { type: 'error', message: 'Please log in to continue.' };
    return res.redirect('/login');
  }
  next();
}

/** Expose and clear any one-time flash message for templates. */
function flash(req, res, next) {
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
}

module.exports = { csrf, currentUser, requireLogin, flash };
