'use strict';

const db = require('../db');

// Attaches the logged-in user (if any) to req.user and res.locals for views.
function loadUser(req, res, next) {
  if (req.session && req.session.userId) {
    req.user = db
      .prepare('SELECT id, name, email, role FROM users WHERE id = ?')
      .get(req.session.userId);
  }
  res.locals.currentUser = req.user || null;
  next();
}

function requireLogin(req, res, next) {
  if (!req.user) return res.redirect('/login');
  next();
}

// Returns middleware that enforces a specific role.
function requireRole(role) {
  return function (req, res, next) {
    if (!req.user) return res.redirect('/login');
    if (req.user.role !== role) {
      return res.status(403).render('error', {
        title: 'Forbidden',
        message: `This action is restricted to ${role}s.`,
      });
    }
    next();
  };
}

module.exports = { loadUser, requireLogin, requireRole };
