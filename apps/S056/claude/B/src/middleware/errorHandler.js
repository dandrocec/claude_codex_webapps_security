'use strict';

const config = require('../config');

/** 404 handler for unmatched routes. */
function notFound(req, res) {
  res.status(404).json({ error: 'Not found.' });
}

/**
 * Central error handler. Logs the full error server-side but never leaks stack
 * traces or internal details to clients.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Log internally for diagnostics.
  // eslint-disable-next-line no-console
  console.error(err);

  // Malformed JSON body produced by express.json()
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed JSON in request body.' });
  }

  const status = err.status || 500;
  const message =
    status >= 500
      ? 'An unexpected error occurred.'
      : err.expose
        ? err.message
        : 'Request could not be processed.';

  res.status(status).json({ error: message });

  // Keep config referenced for future env-specific behaviour without leaking.
  void config;
}

module.exports = { notFound, errorHandler };
