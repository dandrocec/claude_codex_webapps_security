'use strict';

// Require an authenticated session for protected routes.
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  return res.redirect('/login');
}

// Redirect already-authenticated users away from login/register pages.
function redirectIfAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return res.redirect('/movies');
  }
  return next();
}

module.exports = { requireAuth, redirectIfAuth };
