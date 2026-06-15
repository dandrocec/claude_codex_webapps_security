'use strict';

const crypto = require('crypto');

/**
 * CSRF protection using the synchronizer token pattern.
 *
 * A random token is stored in the (server-side) session and must be echoed
 * back in a hidden form field on every state-changing request. Because the
 * token lives in the session and an attacker on another origin cannot read
 * it, forged cross-site POSTs are rejected.
 */
function csrf(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }

  // Expose a helper to templates for rendering the hidden field / meta tag.
  res.locals.csrfToken = req.session.csrfToken;

  const stateChanging = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (stateChanging) {
    const submitted =
      (req.body && req.body._csrf) ||
      req.get('x-csrf-token') ||
      req.get('x-xsrf-token');

    const expected = req.session.csrfToken;
    const ok =
      typeof submitted === 'string' &&
      submitted.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(submitted), Buffer.from(expected));

    if (!ok) {
      return res.status(403).render('error', {
        title: 'Request blocked',
        message: 'Invalid or missing CSRF token. Please reload the page and try again.',
      });
    }
  }

  next();
}

/** Require an authenticated session; otherwise redirect to login. */
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  return res.redirect('/login');
}

/** Make the current user available to all views as `currentUser`. */
function exposeUser(req, res, next) {
  res.locals.currentUser = req.session.userId
    ? { id: req.session.userId, username: req.session.username }
    : null;
  next();
}

module.exports = { csrf, requireAuth, exposeUser };
