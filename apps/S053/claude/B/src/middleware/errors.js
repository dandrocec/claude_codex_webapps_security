'use strict';

const config = require('../config');

// 404 handler — reached when no route matched.
function notFound(req, res, next) {
  res.status(404);
  if (req.accepts('html')) {
    return res.render('error', { status: 404, message: 'Page not found' });
  }
  return res.json({ error: 'Not found' });
}

// Central error handler. Never leaks stack traces or internal messages to the
// client; details are logged server-side only. Errors explicitly marked
// `expose = true` (e.g. validation, CSRF) may show their message.
// eslint-disable-next-line no-unused-vars -- Express needs the 4-arg signature.
function errorHandler(err, req, res, next) {
  const status = err.status || 500;

  // Log full details server-side for diagnosis.
  if (status >= 500) {
    console.error(err);
  }

  const safeMessage =
    err.expose && err.message ? err.message : 'Something went wrong. Please try again.';

  res.status(status);
  if (req.accepts('html')) {
    return res.render('error', {
      status,
      message: status >= 500 ? 'Internal server error' : safeMessage,
    });
  }
  return res.json({
    error: status >= 500 ? 'Internal server error' : safeMessage,
  });
}

module.exports = { notFound, errorHandler };
