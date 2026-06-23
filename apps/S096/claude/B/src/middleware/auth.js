'use strict';

const users = require('../services/users');

// Loads the current user (if any) onto req/res for every web request.
function loadUser(req, res, next) {
  if (req.session && req.session.userId) {
    const user = users.findById(req.session.userId);
    if (user) {
      req.user = user;
      res.locals.currentUser = user;
    } else {
      // Session points at a deleted user — clear it.
      req.session.userId = undefined;
    }
  }
  next();
}

// Gate for pages that require a logged-in developer.
function requireAuth(req, res, next) {
  if (req.user) return next();
  return res.redirect('/login');
}

// Redirect already-authenticated users away from login/register.
function requireGuest(req, res, next) {
  if (req.user) return res.redirect('/dashboard');
  return next();
}

module.exports = { loadUser, requireAuth, requireGuest };
