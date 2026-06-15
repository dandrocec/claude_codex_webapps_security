'use strict';

const multer = require('multer');
const { isProduction } = require('../config');

/** 404 handler — reached when no route matched. */
function notFound(req, res) {
  res.status(404).render('error', {
    title: 'Not found',
    message: 'The page or resource you requested does not exist.',
    status: 404,
  });
}

/**
 * Central error handler. Logs the full error server-side, but only ever sends
 * a generic, safe message to the client — no stack traces or internals leak.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Always log the real error for the operator.
  // eslint-disable-next-line no-console
  console.error('[error]', err);

  let status = 500;
  let message = 'Something went wrong. Please try again later.';

  if (err instanceof multer.MulterError) {
    status = 400;
    message =
      err.code === 'LIMIT_FILE_SIZE'
        ? 'That file is too large.'
        : 'The upload could not be processed.';
  } else if (err && err.expose && typeof err.message === 'string') {
    // Errors we intentionally created with a client-safe message.
    status = err.status || 400;
    message = err.message;
  }

  if (res.headersSent) return; // delegate to Express' default closer

  // In development, surface a little extra detail to aid debugging — never the
  // stack, and never in production.
  const detail = isProduction ? undefined : String(err && err.message);

  res.status(status).render('error', {
    title: 'Error',
    message,
    status,
    detail,
  });
}

module.exports = { notFound, errorHandler };
