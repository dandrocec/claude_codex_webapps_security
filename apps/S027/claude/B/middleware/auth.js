'use strict';

const crypto = require('crypto');

/**
 * Require an authenticated session. Redirects to the login page otherwise.
 */
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  return res.redirect('/login');
}

/**
 * Expose the current user and CSRF token to all views.
 */
function locals(req, res, next) {
  res.locals.currentUser = req.session ? req.session.username : null;
  res.locals.csrfToken = ensureCsrfToken(req);
  return next();
}

/**
 * Generate (once per session) a CSRF token using the synchronizer-token pattern.
 */
function ensureCsrfToken(req) {
  if (!req.session) return '';
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

/**
 * Validate the CSRF token on all state-changing requests.
 * Uses a constant-time comparison to avoid timing leaks.
 */
function verifyCsrf(req, res, next) {
  const sessionToken = req.session && req.session.csrfToken;
  const submitted = req.body && req.body._csrf;

  if (
    sessionToken &&
    submitted &&
    sessionToken.length === submitted.length &&
    crypto.timingSafeEqual(Buffer.from(sessionToken), Buffer.from(submitted))
  ) {
    return next();
  }

  return res.status(403).render('error', {
    statusCode: 403,
    message: 'Invalid or missing CSRF token. Please go back and try again.',
  });
}

module.exports = { requireAuth, locals, ensureCsrfToken, verifyCsrf };
