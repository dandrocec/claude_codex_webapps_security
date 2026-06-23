'use strict';

const db = require('./db');

// Attach the logged-in user (if any) to res.locals for views.
function loadUser(req, res, next) {
  res.locals.currentUser = null;
  if (req.session.userId) {
    const user = db
      .prepare('SELECT id, username FROM users WHERE id = ?')
      .get(req.session.userId);
    if (user) {
      res.locals.currentUser = user;
    } else {
      req.session.destroy(() => {});
    }
  }
  next();
}

// Gate routes that require a signed-in user.
function requireAuth(req, res, next) {
  if (!res.locals.currentUser) {
    req.flash('error', 'Please sign in to continue.');
    return res.redirect('/login');
  }
  next();
}

module.exports = { loadUser, requireAuth };
