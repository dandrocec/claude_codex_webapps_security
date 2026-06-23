'use strict';

/** Reject API requests that have no authenticated session. */
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  return res.status(401).json({ error: 'Authentication required' });
}

/** Wrap an async route so thrown errors become a 500 JSON response. */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { requireAuth, asyncHandler };
