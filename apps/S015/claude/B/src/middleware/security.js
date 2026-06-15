'use strict';

const crypto = require('crypto');

/**
 * CSRF protection using the synchronizer-token pattern.
 *
 * A random token is stored in the (server-side) session and must be echoed back
 * in a hidden form field on every state-changing request. Because an attacker's
 * cross-site form cannot read the victim's session token, forged POSTs are
 * rejected. Tokens are compared in constant time to avoid timing leaks.
 */
function csrfProtection(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }

  // Expose the token to all templates so forms can embed it.
  res.locals.csrfToken = req.session.csrfToken;

  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) {
    return next();
  }

  const submitted = req.body && req.body._csrf;
  const expected = req.session.csrfToken;

  const ok =
    typeof submitted === 'string' &&
    submitted.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(submitted), Buffer.from(expected));

  if (!ok) {
    return res.status(403).render('error', {
      title: 'Request blocked',
      message: 'Invalid or missing security token. Please reload the page and try again.',
    });
  }

  return next();
}

/** Require an authenticated session; otherwise send the user to the login page. */
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  return res.redirect('/login');
}

/** Make the current user available to templates (or null when logged out). */
function exposeUser(req, res, next) {
  res.locals.currentUser = req.session && req.session.username
    ? { id: req.session.userId, username: req.session.username }
    : null;
  next();
}

module.exports = { csrfProtection, requireAuth, exposeUser };
