'use strict';

const crypto = require('crypto');

// Synchroniser-token CSRF protection.
//
// A random token is stored in the (signed, HttpOnly) session and echoed into
// every form. On state-changing requests we compare the submitted token to the
// session copy using a constant-time comparison. Because an attacker's site
// cannot read the victim's session token, it cannot forge a valid request.

function ensureToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

// Exposes res.locals.csrfToken to all templates and validates unsafe methods.
function csrfProtection(req, res, next) {
  const token = ensureToken(req);
  res.locals.csrfToken = token;

  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) {
    return next();
  }

  const submitted = req.body && req.body._csrf;
  if (
    typeof submitted === 'string' &&
    submitted.length === token.length &&
    crypto.timingSafeEqual(Buffer.from(submitted), Buffer.from(token))
  ) {
    return next();
  }

  res.status(403);
  return res.render('error', {
    title: 'Forbidden',
    message: 'Invalid or missing CSRF token. Please reload the page and try again.',
  });
}

module.exports = { csrfProtection };
