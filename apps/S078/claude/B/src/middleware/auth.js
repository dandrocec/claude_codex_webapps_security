'use strict';

const { Users } = require('../models');

// Loads the current user (if any) onto req.user and res.locals for every
// request. Keeps templates free of session plumbing.
function loadUser(req, res, next) {
  if (req.session && req.session.userId) {
    const user = Users.byId(req.session.userId);
    if (user) {
      req.user = user;
      res.locals.currentUser = user;
    } else {
      // Session points at a deleted user; clear it.
      req.session.destroy(() => {});
    }
  }
  next();
}

// Gate for authenticated routes.
function requireAuth(req, res, next) {
  if (req.user) return next();
  return res.redirect('/login');
}

// Gate for manager-only routes.
function requireManager(req, res, next) {
  if (req.user && req.user.role === 'manager') return next();
  res.status(403);
  return res.render('error', {
    title: 'Forbidden',
    message: 'You do not have permission to view this page.',
  });
}

module.exports = { loadUser, requireAuth, requireManager };
