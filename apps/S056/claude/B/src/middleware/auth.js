'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');

/**
 * Verifies the JWT carried in the HttpOnly auth cookie and attaches the
 * authenticated user to req.user. Rejects unauthenticated requests.
 */
function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies[config.authCookieName];
  if (!token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.user = { id: payload.sub, username: payload.username };
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session.' });
  }
}

module.exports = { requireAuth };
