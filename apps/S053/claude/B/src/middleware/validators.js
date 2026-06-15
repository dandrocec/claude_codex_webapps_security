'use strict';

const { body, validationResult } = require('express-validator');

// Collects validation errors and re-renders the given view with the submitted
// values and messages, instead of throwing. Keeps user input out of error
// pages except through the auto-escaping template engine.
function handleValidation(view, buildLocals) {
  return (req, res, next) => {
    const result = validationResult(req);
    if (result.isEmpty()) return next();

    const errors = result.array().map((e) => e.msg);
    const status = 422;
    res.status(status);
    return res.render(view, {
      ...(buildLocals ? buildLocals(req) : {}),
      errors,
    });
  };
}

// Only allow http(s) URLs (or empty). Blocks javascript:, data:, etc. which
// could otherwise be reflected into href/src attributes.
function isHttpUrlOrEmpty(value) {
  if (!value) return true;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

const credentialRules = [
  body('username')
    .trim()
    .isLength({ min: 3, max: 32 })
    .withMessage('Username must be 3–32 characters.')
    .matches(/^[A-Za-z0-9_.-]+$/)
    .withMessage('Username may contain letters, numbers, and . _ - only.'),
  body('password')
    .isLength({ min: 10, max: 128 })
    .withMessage('Password must be at least 10 characters.'),
];

const projectRules = [
  body('title')
    .trim()
    .isLength({ min: 1, max: 120 })
    .withMessage('Title is required (max 120 characters).'),
  body('description')
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Description must be at most 2000 characters.'),
  body('link')
    .trim()
    .custom(isHttpUrlOrEmpty)
    .withMessage('Link must be a valid http(s) URL.'),
  body('imageUrl')
    .trim()
    .custom(isHttpUrlOrEmpty)
    .withMessage('Image URL must be a valid http(s) URL.'),
];

module.exports = {
  handleValidation,
  credentialRules,
  projectRules,
};
