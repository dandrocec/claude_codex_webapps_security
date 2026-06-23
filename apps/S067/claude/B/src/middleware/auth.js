'use strict';

/**
 * Authentication & access-control middleware.
 *
 * Access control is enforced server-side on every protected route. Resource
 * ownership is checked at the data layer (see routes/orders.js) to prevent IDOR.
 */

function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.redirect('/login');
  }
  return next();
}

/**
 * Restrict a route to one or more roles.
 * @param  {...string} roles allowed roles
 */
function requireRole(...roles) {
  return function (req, res, next) {
    if (!req.session || !req.session.user) {
      return res.redirect('/login');
    }
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).render('error', {
        title: 'Forbidden',
        status: 403,
        message: 'You do not have permission to access this page.'
      });
    }
    return next();
  };
}

/** Redirect already-authenticated users away from login/register pages. */
function redirectIfAuthed(req, res, next) {
  if (req.session && req.session.user) {
    return res.redirect('/menu');
  }
  return next();
}

module.exports = { requireAuth, requireRole, redirectIfAuthed };
