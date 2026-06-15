'use strict';

// Expose the current user (if any) to all views.
function currentUser(req, res, next) {
  res.locals.user = req.session.user || null;
  next();
}

// Gate reviewer-only pages. Enforces access control (OWASP A01):
// unauthenticated requests are redirected to the login page; a session
// without the reviewer role is rejected.
function requireReviewer(req, res, next) {
  const user = req.session.user;
  if (!user) {
    return res.redirect('/login');
  }
  if (user.role !== 'reviewer') {
    const err = new Error('Forbidden');
    err.status = 403;
    return next(err);
  }
  return next();
}

module.exports = { currentUser, requireReviewer };
