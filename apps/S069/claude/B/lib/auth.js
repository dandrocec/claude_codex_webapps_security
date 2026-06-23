'use strict';

const db = require('../db');

// Load the current user (if any) from the session into res.locals for templates.
function loadUser(req, res, next) {
  res.locals.currentUser = null;
  if (req.session && req.session.userId) {
    const user = db
      .prepare('SELECT id, email, display_name FROM users WHERE id = ?')
      .get(req.session.userId);
    if (user) {
      req.user = user;
      res.locals.currentUser = user;
    } else {
      // Session points at a deleted user; clear it.
      req.session.userId = null;
    }
  }
  next();
}

// Guard for routes that require authentication.
function requireAuth(req, res, next) {
  if (!req.user) {
    return res.redirect('/login');
  }
  next();
}

module.exports = { loadUser, requireAuth };
