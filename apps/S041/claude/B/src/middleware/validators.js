'use strict';

const { body, param, validationResult } = require('express-validator');

// Shared validation chains. trim() + escape-on-output (handled by EJS) plus
// length bounds keep input well-formed and bounded. We deliberately do NOT
// HTML-escape on input — output encoding in templates is context-aware and
// avoids double-encoding stored data.

const faqValidators = [
  body('question')
    .trim()
    .isLength({ min: 3, max: 500 })
    .withMessage('Question must be between 3 and 500 characters.'),
  body('answer')
    .trim()
    .isLength({ min: 3, max: 5000 })
    .withMessage('Answer must be between 3 and 5000 characters.'),
  body('category')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Category is required (max 100 characters).')
    .matches(/^[\p{L}\p{N} _&'/().-]+$/u)
    .withMessage('Category contains invalid characters.'),
];

const loginValidators = [
  body('username').trim().isLength({ min: 1, max: 100 }),
  body('password').isLength({ min: 1, max: 200 }),
];

const idParam = [param('id').isInt({ min: 1 }).toInt()];

const reorderValidators = [
  param('id').isInt({ min: 1 }).toInt(),
  body('direction').isIn(['up', 'down']),
];

// Collects validation errors into req for the route to render.
function collectErrors(req) {
  const result = validationResult(req);
  return result.isEmpty() ? null : result.array().map((e) => e.msg);
}

module.exports = {
  faqValidators,
  loginValidators,
  idParam,
  reorderValidators,
  collectErrors,
};
