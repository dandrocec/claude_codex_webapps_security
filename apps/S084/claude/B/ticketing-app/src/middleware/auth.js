'use strict';

// Require an authenticated session. Used to guard state-changing and
// account-specific routes (access control / prevents anonymous access).
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  return res.redirect('/login');
}

// Redirect already-authenticated users away from login/register pages.
function redirectIfAuthenticated(req, res, next) {
  if (req.session && req.session.userId) {
    return res.redirect('/events');
  }
  return next();
}

module.exports = { requireAuth, redirectIfAuthenticated };
