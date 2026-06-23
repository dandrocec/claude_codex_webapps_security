'use strict';

// Requires a logged-in user. Otherwise redirect to the login page.
function requireLogin(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  req.flash('error', 'Please log in to continue.');
  return res.redirect('/login');
}

// Requires the logged-in user to have one of the given roles.
function requireRole(...roles) {
  return function (req, res, next) {
    const user = req.session && req.session.user;
    if (!user) {
      req.flash('error', 'Please log in to continue.');
      return res.redirect('/login');
    }
    if (!roles.includes(user.role)) {
      res.status(403);
      return res.render('error', {
        title: 'Forbidden',
        message: 'You do not have permission to perform this action.',
      });
    }
    return next();
  };
}

module.exports = { requireLogin, requireRole };
