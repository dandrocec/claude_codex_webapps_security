'use strict';

const { statements } = require('../db');

/**
 * Populates res.locals.currentUser from the session on every request.
 * Keeps templates and route handlers from touching the session directly.
 */
function loadCurrentUser(req, res, next) {
  res.locals.currentUser = null;
  const userId = req.session && req.session.userId;
  if (userId) {
    const user = statements.findUserById.get(userId);
    if (user) {
      res.locals.currentUser = user;
    } else {
      // Session points at a user that no longer exists — drop it.
      req.session.userId = undefined;
    }
  }
  next();
}

/** Gate for routes that require an authenticated user. */
function requireAuth(req, res, next) {
  if (res.locals.currentUser) return next();
  if (req.method === 'GET') {
    return res.redirect('/login');
  }
  return res.status(401).render('error', {
    title: 'Sign in required',
    message: 'You must be signed in to do that.',
    status: 401,
  });
}

/** Inverse: only for anonymous visitors (login/register pages). */
function requireAnonymous(req, res, next) {
  if (res.locals.currentUser) return res.redirect('/files');
  next();
}

module.exports = { loadCurrentUser, requireAuth, requireAnonymous };
