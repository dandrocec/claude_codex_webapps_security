'use strict';

const models = require('../models');

// Populate res.locals.currentUser for every request so views can render
// auth-aware UI without leaking sensitive fields.
function loadUser(req, res, next) {
  res.locals.currentUser = null;
  if (req.session.userId) {
    const user = models.getUserById(req.session.userId);
    if (user) {
      req.user = user;
      res.locals.currentUser = user;
    } else {
      // Stale session referencing a deleted user.
      req.session.userId = null;
    }
  }
  next();
}

// Gate that requires an authenticated user for protected routes.
function requireAuth(req, res, next) {
  if (!req.user) {
    return res.redirect('/login');
  }
  next();
}

module.exports = { loadUser, requireAuth };
