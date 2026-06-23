'use strict';

// Requires an authenticated session. Used to guard every booking-related route
// so unauthenticated users are redirected to the login page.
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  req.session.returnTo = req.originalUrl;
  req.flash('error', 'Please log in to continue.');
  return res.redirect('/login');
}

// Makes the current user available to all templates (for the nav bar etc.).
function exposeUser(req, res, next) {
  res.locals.currentUser = req.session.userId
    ? { id: req.session.userId, username: req.session.username }
    : null;
  next();
}

module.exports = { requireAuth, exposeUser };
