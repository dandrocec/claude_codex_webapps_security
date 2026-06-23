'use strict';

function notFound(req, res, next) {
  res.status(404);
  if (req.accepts('html')) {
    return res.render('error', { title: 'Not found', message: 'Page not found.', status: 404 });
  }
  return res.json({ error: 'Not found' });
}

// Centralised error handler. Never leaks stack traces or internal details to
// clients: only errors explicitly marked `expose` (e.g. validation/CSRF) show
// their message; everything else returns a generic message. Full details are
// logged server-side only.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || 500;

  if (status >= 500) {
    // eslint-disable-next-line no-console
    console.error('[error]', err);
  }

  const clientMessage =
    err.expose && err.message ? err.message : 'Something went wrong. Please try again.';

  res.status(status);
  if (req.accepts('html')) {
    return res.render('error', {
      title: 'Error',
      message: clientMessage,
      status,
    });
  }
  return res.json({ error: clientMessage });
}

module.exports = { notFound, errorHandler };
