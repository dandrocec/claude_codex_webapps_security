'use strict';

const db = require('../db');

// Loads the current user (if logged in) onto req.user and res.locals.currentUser.
function loadUser(req, res, next) {
  res.locals.currentUser = null;
  req.user = null;
  if (req.session && req.session.userId) {
    const user = db
      .prepare('SELECT id, username, created_at FROM users WHERE id = ?')
      .get(req.session.userId);
    if (user) {
      req.user = user;
      res.locals.currentUser = user;
    } else {
      // Session refers to a deleted user; clear it.
      req.session.userId = undefined;
    }
  }
  next();
}

// Gate for routes that require authentication.
function requireAuth(req, res, next) {
  if (!req.user) {
    if (req.method === 'GET') {
      return res.redirect('/login');
    }
    const err = new Error('Authentication required');
    err.status = 401;
    err.expose = true;
    return next(err);
  }
  next();
}

module.exports = { loadUser, requireAuth };
