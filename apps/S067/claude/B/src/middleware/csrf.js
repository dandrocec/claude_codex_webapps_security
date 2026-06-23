'use strict';

/**
 * CSRF protection using the synchroniser-token pattern.
 *
 * A random token is stored in the session and must accompany every
 * state-changing request (POST/PUT/PATCH/DELETE) via the `_csrf` form field
 * or the `x-csrf-token` header. The token is compared in constant time.
 */

const crypto = require('crypto');

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function ensureToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = generateToken();
  }
  return req.session.csrfToken;
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function csrfProtection(req, res, next) {
  // Make the token available to all templates.
  const token = ensureToken(req);
  res.locals.csrfToken = token;

  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  const submitted =
    (req.body && req.body._csrf) ||
    req.get('x-csrf-token') ||
    req.get('x-xsrf-token');

  if (!submitted || !safeEqual(submitted, token)) {
    return res.status(403).render('error', {
      title: 'Invalid request',
      status: 403,
      message: 'Your session token was missing or invalid. Please go back and try again.'
    });
  }

  return next();
}

module.exports = { csrfProtection };
