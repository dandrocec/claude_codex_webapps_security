'use strict';

const db = require('../db');

const getUserStmt = db.prepare('SELECT id, email FROM users WHERE id = ?');

// Populates res.locals.currentUser from the session, if logged in.
function loadUser(req, res, next) {
  res.locals.currentUser = null;
  if (req.session && req.session.userId) {
    const user = getUserStmt.get(req.session.userId);
    if (user) {
      req.user = user;
      res.locals.currentUser = user;
    } else {
      // Stale session referencing a deleted user.
      req.session.destroy(() => {});
    }
  }
  next();
}

// Guards routes that require authentication.
function requireAuth(req, res, next) {
  if (req.user) return next();
  return res.redirect('/login');
}

module.exports = { loadUser, requireAuth };
