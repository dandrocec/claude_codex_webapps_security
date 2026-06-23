'use strict';

/**
 * CSRF protection using the synchronizer-token pattern.
 *
 * A random token is stored in the (server-side) session. Every rendered form
 * embeds it in a hidden field, and every state-changing request (POST/PUT/
 * PATCH/DELETE) must echo it back. The token is compared in constant time.
 *
 * Because the token lives in the session (not a readable cookie) and is
 * required on all mutating requests, a cross-site request cannot forge it.
 */

const crypto = require('crypto');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function ensureToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

function constantTimeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function csrfProtection(req, res, next) {
  // Make the token available to every view via res.locals.csrfToken.
  const token = ensureToken(req);
  res.locals.csrfToken = token;

  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  const submitted =
    (req.body && req.body._csrf) ||
    req.get('x-csrf-token') ||
    req.get('x-xsrf-token');

  if (!submitted || !constantTimeEqual(submitted, token)) {
    const err = new Error('Invalid or missing CSRF token');
    err.status = 403;
    err.publicMessage = 'Your session expired or the form was invalid. Please try again.';
    return next(err);
  }

  return next();
}

module.exports = { csrfProtection };
