'use strict';

const { validationResult } = require('express-validator');

/**
 * Collects express-validator errors and returns a 400 with a clean message.
 * Field-level messages are safe (they describe constraints, not internals).
 */
function handleValidation(req, res, next) {
  const result = validationResult(req);
  if (!result.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed.',
      details: result.array().map((e) => ({ field: e.path, message: e.msg })),
    });
  }
  return next();
}

module.exports = { handleValidation };
