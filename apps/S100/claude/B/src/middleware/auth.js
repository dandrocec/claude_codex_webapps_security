'use strict';

/**
 * Authentication and authorisation middleware.
 *
 *  - requireAuth      : must be logged in.
 *  - requireOperator  : must be logged in AND have the 'operator' role.
 *  - loadCurrentUser  : populates req.user / res.locals.currentUser from session.
 *
 * Resource-level (per-owner) access control lives in the service routes, where
 * ownership is checked against the authenticated user's id to prevent IDOR.
 */

const userModel = require('../models/userModel');

function loadCurrentUser(req, res, next) {
  res.locals.currentUser = null;
  req.user = null;
  if (req.session && req.session.userId) {
    const user = userModel.findById(req.session.userId);
    if (user) {
      req.user = user;
      res.locals.currentUser = { id: user.id, username: user.username, role: user.role };
    } else {
      // Session points at a user that no longer exists — clear it.
      req.session.userId = undefined;
    }
  }
  next();
}

function requireAuth(req, res, next) {
  if (req.user) return next();
  req.flash('error', 'Please sign in to continue.');
  return res.redirect('/login');
}

function requireOperator(req, res, next) {
  if (!req.user) {
    req.flash('error', 'Please sign in to continue.');
    return res.redirect('/login');
  }
  if (req.user.role !== 'operator') {
    const err = new Error('Operator role required');
    err.status = 403;
    err.publicMessage = 'You need the operator role to perform this action.';
    return next(err);
  }
  return next();
}

module.exports = { loadCurrentUser, requireAuth, requireOperator };
