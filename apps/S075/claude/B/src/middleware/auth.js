'use strict';

/**
 * Authentication & authorization middleware.
 * Access control is enforced server-side on every protected route.
 */

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

function requireRole(role) {
  return function (req, res, next) {
    if (!req.session.user) {
      return res.redirect('/login');
    }
    if (req.session.user.role !== role) {
      // Authenticated but not authorized for this area.
      return res.status(403).render('error', {
        title: 'Forbidden',
        message: 'You do not have permission to access this page.',
        status: 403,
      });
    }
    next();
  };
}

module.exports = { requireLogin, requireRole };
