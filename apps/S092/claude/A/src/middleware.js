'use strict';

// Makes the logged-in user available to every view as `currentUser`.
function exposeUser(req, res, next) {
  res.locals.currentUser = req.session.user || null;
  next();
}

// Gate: must be logged in.
function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

// Gate: must be logged in AND hold one of the allowed roles.
// This is the core role-based access control check.
function requireRole(...allowed) {
  return function (req, res, next) {
    const user = req.session.user;
    if (!user) return res.redirect('/login');
    if (!allowed.includes(user.role)) {
      return res.status(403).render('error', {
        title: 'Forbidden',
        message: `Your role (${user.role}) is not allowed to access this page.`,
      });
    }
    next();
  };
}

module.exports = { exposeUser, requireLogin, requireRole };
