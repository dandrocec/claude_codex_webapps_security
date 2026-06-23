'use strict';

const crypto = require('crypto');
const config = require('../config');

/**
 * Double-submit cookie CSRF protection.
 *
 * Because auth is carried in a cookie (ambient credential), state-changing
 * requests must prove they originate from our own front-end. We set a random
 * CSRF token in a NON-HttpOnly cookie that same-origin JS can read, and require
 * the caller to echo it back in the X-CSRF-Token header. A cross-site attacker
 * cannot read the cookie value (SameSite + same-origin policy) and therefore
 * cannot forge the header.
 */

function generateCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

/** Sets/refreshes the CSRF cookie and returns the token value. */
function issueCsrfToken(res) {
  const token = generateCsrfToken();
  res.cookie(config.csrfCookieName, token, {
    httpOnly: false, // must be readable by the front-end to echo it back
    secure: config.isProduction,
    sameSite: 'strict',
    path: '/',
  });
  return token;
}

/** Timing-safe string comparison. */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Enforces CSRF token match on state-changing requests. */
function verifyCsrf(req, res, next) {
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) {
    return next();
  }

  const cookieToken = req.cookies && req.cookies[config.csrfCookieName];
  const headerToken = req.get(config.csrfHeaderName);

  if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken)) {
    return res.status(403).json({ error: 'Invalid or missing CSRF token.' });
  }

  return next();
}

module.exports = { issueCsrfToken, verifyCsrf };
