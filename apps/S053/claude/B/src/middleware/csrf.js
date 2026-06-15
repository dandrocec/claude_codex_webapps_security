'use strict';

const crypto = require('crypto');

// Synchronizer-token CSRF protection.
//
// A random token is stored in the (server-side, signed-cookie-backed) session
// and must be echoed back in a hidden form field (_csrf) or the x-csrf-token
// header on every state-changing request. Because an attacker's cross-site
// page cannot read the victim's session token, forged requests are rejected.
// We compare with timingSafeEqual to avoid timing side channels.

function getOrCreateToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

// Exposes res.locals.csrfToken to all templates.
function provideToken(req, res, next) {
  res.locals.csrfToken = getOrCreateToken(req);
  next();
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function verifyToken(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const expected = req.session && req.session.csrfToken;
  const provided =
    (req.body && req.body._csrf) ||
    req.get('x-csrf-token') ||
    req.get('x-xsrf-token');

  if (
    expected &&
    typeof provided === 'string' &&
    provided.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  ) {
    return next();
  }

  const err = new Error('Invalid or missing CSRF token');
  err.status = 403;
  err.expose = true;
  return next(err);
}

module.exports = { provideToken, verifyToken };
