'use strict';

const { db } = require('./db');

const getUserById = db.prepare('SELECT id, username, email FROM users WHERE id = ?');

// Populate res.locals.currentUser for every request (used by views/nav).
function loadUser(req, res, next) {
  res.locals.currentUser = null;
  if (req.session && req.session.userId) {
    const user = getUserById.get(req.session.userId);
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

// Gate that requires an authenticated session.
function requireAuth(req, res, next) {
  if (!req.user) {
    return res.redirect('/login');
  }
  next();
}

module.exports = { loadUser, requireAuth };
