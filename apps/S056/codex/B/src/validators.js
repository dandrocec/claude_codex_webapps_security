const { body, param, validationResult } = require('express-validator');
const xss = require('xss');

function normalizeText(value) {
  return xss(String(value || '').trim(), {
    whiteList: {},
    stripIgnoreTag: true,
    stripIgnoreTagBody: ['script']
  });
}

function handleValidation(req, res, next) {
  const result = validationResult(req);
  if (!result.isEmpty()) {
    return res.status(400).json({
      error: 'Invalid request',
      details: result.array().map((item) => ({
        field: item.path,
        message: item.msg
      }))
    });
  }
  return next();
}

const registerRules = [
  body('username')
    .isString()
    .trim()
    .isLength({ min: 3, max: 50 })
    .withMessage('Username must be 3 to 50 characters')
    .matches(/^[a-zA-Z0-9_.-]+$/)
    .withMessage('Username may contain letters, numbers, dots, underscores, and hyphens only'),
  body('password')
    .isString()
    .isLength({ min: 12, max: 128 })
    .withMessage('Password must be 12 to 128 characters')
];

const loginRules = [
  body('username').isString().trim().isLength({ min: 3, max: 50 }),
  body('password').isString().isLength({ min: 1, max: 128 })
];

const taskRules = [
  body('title')
    .isString()
    .customSanitizer(normalizeText)
    .isLength({ min: 1, max: 120 })
    .withMessage('Title must be 1 to 120 characters'),
  body('description')
    .optional({ values: 'falsy' })
    .isString()
    .customSanitizer(normalizeText)
    .isLength({ max: 2000 })
    .withMessage('Description must be 2000 characters or less'),
  body('done')
    .optional()
    .isBoolean()
    .withMessage('Done must be a boolean')
    .toBoolean()
];

const taskUpdateRules = [
  body('title')
    .optional()
    .isString()
    .customSanitizer(normalizeText)
    .isLength({ min: 1, max: 120 })
    .withMessage('Title must be 1 to 120 characters'),
  body('description')
    .optional()
    .isString()
    .customSanitizer(normalizeText)
    .isLength({ max: 2000 })
    .withMessage('Description must be 2000 characters or less'),
  body('done')
    .optional()
    .isBoolean()
    .withMessage('Done must be a boolean')
    .toBoolean(),
  body().custom((value) => {
    const allowed = ['title', 'description', 'done'];
    return Object.keys(value).some((key) => allowed.includes(key));
  }).withMessage('At least one task field is required')
];

const idParamRules = [
  param('id').isInt({ min: 1 }).withMessage('Task id must be a positive integer').toInt()
];

module.exports = {
  handleValidation,
  idParamRules,
  loginRules,
  registerRules,
  taskRules,
  taskUpdateRules
};
