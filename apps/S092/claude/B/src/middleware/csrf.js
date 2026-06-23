'use strict';

const crypto = require('crypto');

// Synchroniser-token CSRF protection.
//  - A per-session secret token is generated on first request.
//  - It is exposed to templates via res.locals.csrfToken for inclusion in forms.
//  - Every state-changing request (POST/PUT/PATCH/DELETE) must echo it back,
//    and we compare in constant time. Mismatch => 403.
function csrfProtection(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;

  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) {
    return next();
  }

  const submitted =
    (req.body && req.body._csrf) ||
    req.get('x-csrf-token') ||
    req.get('x-xsrf-token') ||
    '';

  const expected = req.session.csrfToken;
  const a = Buffer.from(String(submitted));
  const b = Buffer.from(String(expected));

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).render('error', {
      title: 'Invalid request',
      message: 'Your session token was missing or invalid. Please go back and try again.',
      status: 403,
    });
  }

  return next();
}

module.exports = { csrfProtection };
