'use strict';

const { findUserById } = require('../models');

// Loads the current user (if any) onto req.user / res.locals.currentUser.
function loadUser(req, res, next) {
  // Always define the template local so views can reference it safely.
  res.locals.currentUser = null;
  if (req.session && req.session.userId) {
    const user = findUserById(req.session.userId);
    if (user) {
      req.user = user;
      res.locals.currentUser = user;
    } else {
      // Session points at a user that no longer exists -> clear it.
      req.session.userId = undefined;
    }
  }
  next();
}

// Gate for protected routes. Enforces authentication (access control).
function requireAuth(req, res, next) {
  if (req.user) return next();
  return res.redirect('/login');
}

module.exports = { loadUser, requireAuth };
