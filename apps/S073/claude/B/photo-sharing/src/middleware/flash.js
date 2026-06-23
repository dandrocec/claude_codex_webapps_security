'use strict';

// Minimal flash-message support backed by the session. Messages set during a
// request survive exactly one redirect, then are cleared.
function flash(req, res, next) {
  req.flash = (type, message) => {
    if (!req.session.flash) req.session.flash = [];
    req.session.flash.push({ type, message });
  };
  res.locals.flash = req.session.flash || [];
  req.session.flash = [];
  next();
}

module.exports = flash;
