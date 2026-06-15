'use strict';

const users = require('../models/users');

// Loads the current user (if any) onto req.user and res.locals.currentUser
// so views can render the logged-in state.
function loadUser(req, res, next) {
  if (req.session.userId) {
    const user = users.findById(req.session.userId);
    if (user) {
      req.user = user;
      res.locals.currentUser = user;
    } else {
      // Session referenced a user that no longer exists — clear it.
      req.session.userId = undefined;
    }
  }
  next();
}

// Gate for protected routes: enforces authentication (access control).
function requireAuth(req, res, next) {
  if (!req.user) {
    return res.redirect('/login');
  }
  next();
}

// For login/register pages: send already-authenticated users to the dashboard.
function redirectIfAuthed(req, res, next) {
  if (req.user) {
    return res.redirect('/');
  }
  next();
}

module.exports = { loadUser, requireAuth, redirectIfAuthed };
