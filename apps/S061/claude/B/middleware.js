'use strict';

const crypto = require('crypto');

/**
 * Make the current user and a few view helpers available to every template,
 * and load the full user record onto req.user for authenticated requests.
 */
function loadUser(models) {
  return (req, res, next) => {
    req.user = null;
    if (req.session && req.session.userId) {
      const user = models.users.byId(req.session.userId);
      if (user) {
        req.user = user;
      } else {
        // Session points at a deleted user — drop it.
        req.session.userId = undefined;
      }
    }
    res.locals.currentUser = req.user;
    res.locals.flash = req.session ? req.session.flash || null : null;
    if (req.session) req.session.flash = null;
    next();
  };
}

/** Require any authenticated user. */
function requireAuth(req, res, next) {
  if (!req.user) {
    req.session.flash = { type: 'error', message: 'Please sign in to continue.' };
    return res.redirect('/login');
  }
  next();
}

/** Require a specific role (e.g. 'instructor' or 'student'). */
function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) {
      return res.redirect('/login');
    }
    if (req.user.role !== role) {
      return res.status(403).render('error', {
        title: 'Forbidden',
        status: 403,
        message: `This area is for ${role}s only.`,
      });
    }
    next();
  };
}

/* -------------------------- CSRF protection -------------------------- */
//
// Synchronizer-token pattern. A random token is stored in the session and
// echoed into every form. State-changing requests must present a matching
// token; comparison is constant-time to avoid timing leaks.

function ensureCsrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

function csrfProtection(req, res, next) {
  // Expose token to all views regardless of method.
  res.locals.csrfToken = ensureCsrfToken(req);

  const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
  if (safeMethods.has(req.method)) {
    return next();
  }

  const provided = (req.body && req.body._csrf) || req.get('x-csrf-token') || '';
  const expected = req.session.csrfToken || '';

  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).render('error', {
      title: 'Invalid request',
      status: 403,
      message: 'Your session expired or the request could not be verified. Please try again.',
    });
  }
  next();
}

module.exports = { loadUser, requireAuth, requireRole, csrfProtection };
