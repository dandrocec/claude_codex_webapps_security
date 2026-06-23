'use strict';

// Require an authenticated session. Redirects to login otherwise.
function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  return res.redirect('/login');
}

// Require the logged-in user to hold one of the given roles.
// Usage: requireRole('doctor'), requireRole('doctor', 'receptionist')
function requireRole(...roles) {
  return function (req, res, next) {
    if (!req.session || !req.session.user) {
      return res.redirect('/login');
    }
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).render('error', {
        title: 'Forbidden',
        message: 'You do not have permission to access this page.',
        status: 403,
      });
    }
    return next();
  };
}

module.exports = { requireAuth, requireRole };
