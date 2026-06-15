'use strict';

const { Users } = require('../models');

// Loads the current user (if any) from the session onto req.user and res.locals
// so templates can react to login state. Runs on every request.
function loadUser(req, res, next) {
  res.locals.currentUser = null;
  if (req.session && req.session.userId) {
    const user = Users.findById(req.session.userId);
    if (user) {
      req.user = user;
      res.locals.currentUser = user;
    } else {
      // Session points at a deleted user — clear it.
      req.session.userId = null;
    }
  }
  next();
}

// Gate for owner-only routes. Redirects browsers to the login page.
function requireAuth(req, res, next) {
  if (req.user) return next();
  return res.redirect('/login');
}

module.exports = { loadUser, requireAuth };
