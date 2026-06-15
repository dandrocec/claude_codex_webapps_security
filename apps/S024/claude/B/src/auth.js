'use strict';

// Access-control middleware. Routes that mutate or expose a user's own data
// must sit behind requireAuth so that req.session.userId is always present and
// trustworthy downstream (used to scope every query to the owner -> no IDOR).

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  return res.redirect('/login');
}

// For pages that should only be shown to logged-out visitors (login/register).
function requireGuest(req, res, next) {
  if (req.session && req.session.userId) {
    return res.redirect('/dashboard');
  }
  return next();
}

module.exports = { requireAuth, requireGuest };
