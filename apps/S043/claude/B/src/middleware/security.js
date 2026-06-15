'use strict';

const crypto = require('crypto');

/**
 * Synchroniser-token CSRF protection.
 *
 * A random token is bound to the user's session and exposed to templates as
 * `res.locals.csrfToken`. Every state-changing request (POST/PUT/PATCH/DELETE)
 * must echo it back in the `_csrf` field or `x-csrf-token` header. The compare
 * is constant-time to avoid timing oracles.
 */
function csrfProtection(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;

  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) {
    return next();
  }

  const sent = (req.body && req.body._csrf) || req.get('x-csrf-token') || '';
  const expected = req.session.csrfToken;

  const sentBuf = Buffer.from(String(sent));
  const expectedBuf = Buffer.from(String(expected));

  if (
    sentBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(sentBuf, expectedBuf)
  ) {
    const err = new Error('Invalid CSRF token');
    err.status = 403;
    err.expose = true; // safe, generic message
    return next(err);
  }
  return next();
}

/**
 * Assigns a stable, signed-by-session-independent random voter token via an
 * HttpOnly cookie. Used to enforce "one vote per poll" for anonymous users.
 */
function voterToken(req, res, next) {
  let token = req.cookies && req.cookies.voter_token;
  if (!token) {
    token = crypto.randomBytes(32).toString('hex');
    res.cookie('voter_token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.COOKIE_SECURE === 'true',
      maxAge: 1000 * 60 * 60 * 24 * 365, // 1 year
      path: '/',
    });
  }
  req.voterToken = token;
  next();
}

/** Require an authenticated session for the route. */
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  return res.redirect('/login');
}

/** Expose the current user (if any) to all templates. */
function exposeUser(req, res, next) {
  res.locals.currentUser = req.session && req.session.userId
    ? { id: req.session.userId, username: req.session.username }
    : null;
  next();
}

module.exports = { csrfProtection, voterToken, requireAuth, exposeUser };
