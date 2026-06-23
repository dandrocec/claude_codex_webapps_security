'use strict';

// Centralised error handler. Logs the full error server-side but never leaks
// stack traces or internal details to the client.
function notFound(req, res, next) {
  if (req.path.startsWith('/gateway')) {
    return res.status(404).json({ error: 'Not found' });
  }
  return res.status(404).render('error', {
    title: 'Not found',
    status: 404,
    message: 'The page you requested does not exist.',
  });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;

  // Log everything server-side for debugging.
  // eslint-disable-next-line no-console
  console.error(`[error] ${req.method} ${req.originalUrl} -> ${status}:`, err);

  // Only show a message to the client when we explicitly marked it safe, or for
  // 4xx client errors. Server errors always get a generic message.
  const clientMessage =
    err.expose || (status >= 400 && status < 500)
      ? err.message
      : 'An unexpected error occurred. Please try again later.';

  if (req.path.startsWith('/gateway') || req.xhr || req.accepts('json') === 'json') {
    return res.status(status).json({ error: clientMessage });
  }

  if (res.headersSent) return next(err);

  return res.status(status).render('error', {
    title: 'Error',
    status,
    message: clientMessage,
  });
}

module.exports = { notFound, errorHandler };
