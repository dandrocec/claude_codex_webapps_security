'use strict';

const crypto = require('crypto');

/**
 * Require an authenticated session. Rejects unauthenticated API calls with a
 * generic 401 (no information leakage about why).
 */
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  return res.status(401).json({ error: 'Authentication required.' });
}

/**
 * Return (creating if needed) the CSRF token bound to this session.
 */
function getCsrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Synchroniser-token CSRF protection. Safe (idempotent) methods pass through;
 * all state-changing requests must present the session's token via the
 * "X-CSRF-Token" header (or a "_csrf" body field).
 */
function csrfProtection(req, res, next) {
  const SAFE = ['GET', 'HEAD', 'OPTIONS'];
  if (SAFE.includes(req.method)) return next();

  const sent = req.get('x-csrf-token') || (req.body && req.body._csrf);
  const expected = req.session && req.session.csrfToken;

  if (!expected || !sent || !timingSafeEqual(String(sent), expected)) {
    return res.status(403).json({ error: 'Invalid or missing CSRF token.' });
  }
  return next();
}

/**
 * Centralised error handler. Logs full detail server-side, returns a generic
 * message to the client so stack traces / internals never leak.
 */
function errorHandler(err, req, res, _next) {
  // eslint-disable-next-line no-console
  console.error('[error]', err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'An unexpected error occurred.' });
}

module.exports = {
  requireAuth,
  getCsrfToken,
  csrfProtection,
  errorHandler,
};
