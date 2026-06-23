'use strict';

const { users } = require('../models');

// Attach the currently logged-in user (if any) to req and res.locals so
// views can render conditionally. Never trust client input for identity —
// the id comes only from the signed server-side session.
function loadCurrentUser(req, res, next) {
  res.locals.currentUser = null;
  if (req.session && req.session.userId) {
    const user = users.byId.get(req.session.userId);
    if (user) {
      // Never expose the password hash to templates.
      const safe = { id: user.id, username: user.username, email: user.email, bio: user.bio };
      req.currentUser = safe;
      res.locals.currentUser = safe;
    } else {
      // Session references a user that no longer exists.
      req.session.destroy(() => {});
    }
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    req.session.flash = { type: 'error', message: 'Please log in to continue.' };
    return res.redirect('/login');
  }
  next();
}

function redirectIfAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return res.redirect('/');
  }
  next();
}

module.exports = { loadCurrentUser, requireAuth, redirectIfAuth };
