'use strict';

// Authentication & authorisation (access control) middleware.

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.redirect('/login');
  }
  return next();
}

// Role-based access control. Pass one or more allowed roles.
function requireRole(...roles) {
  return function roleGuard(req, res, next) {
    if (!req.session || !req.session.userId) {
      return res.redirect('/login');
    }
    if (!roles.includes(req.session.role)) {
      return res.status(403).render('error', {
        title: 'Forbidden',
        message: 'You do not have permission to perform this action.',
      });
    }
    return next();
  };
}

module.exports = { requireAuth, requireRole };
