'use strict';

const crypto = require('crypto');

/**
 * CSRF protection using the synchronizer token pattern.
 *
 * The token is stored in the (server-side) session and must be echoed back
 * in a hidden form field on every state-changing request. Because the token
 * lives in the session and is bound to the user, an attacker on another
 * origin cannot read or forge it. We avoid the deprecated `csurf` package.
 */

function ensureToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

// Generate/attach a token and expose it to templates via res.locals.
function provideToken(req, res, next) {
  res.locals.csrfToken = ensureToken(req);
  next();
}

// Verify the token on all mutating requests.
function verifyToken(req, res, next) {
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) {
    return next();
  }

  const sent = (req.body && req.body._csrf) || req.get('x-csrf-token');
  const expected = req.session.csrfToken;

  if (
    !expected ||
    !sent ||
    sent.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected))
  ) {
    return res.status(403).render('error', {
      title: 'Invalid request',
      message: 'Your session has expired or the request could not be verified. Please go back and try again.',
      status: 403,
    });
  }
  next();
}

module.exports = { provideToken, verifyToken };
