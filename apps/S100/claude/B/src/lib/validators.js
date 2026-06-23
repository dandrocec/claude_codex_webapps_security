'use strict';

const { body, validationResult } = require('express-validator');

// Reusable rules ----------------------------------------------------------

const username = body('username')
  .trim()
  .isLength({ min: 3, max: 32 })
  .withMessage('Username must be 3–32 characters.')
  .matches(/^[a-zA-Z0-9_.-]+$/)
  .withMessage('Username may only contain letters, numbers, and _ . -');

const password = body('password')
  .isLength({ min: 10, max: 200 })
  .withMessage('Password must be at least 10 characters.');

const role = body('role')
  .trim()
  .isIn(['viewer', 'operator'])
  .withMessage('Role must be viewer or operator.');

const registerRules = [username, password, role];
const loginRules = [
  body('username').trim().notEmpty().withMessage('Username is required.'),
  body('password').notEmpty().withMessage('Password is required.'),
];

const serviceRules = [
  body('name')
    .trim()
    .isLength({ min: 1, max: 80 })
    .withMessage('Service name is required (max 80 chars).'),
  body('repo_url')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 300 })
    .withMessage('Repo URL too long.')
    .isURL({ require_protocol: true, protocols: ['http', 'https', 'ssh', 'git'] })
    .withMessage('Repo URL must be a valid URL.'),
  body('description')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Description too long (max 1000 chars).'),
  // step_name[] and step_command[] arrive as parallel arrays.
  body('step_name').toArray(),
  body('step_command').toArray(),
];

const secretRules = [
  body('key')
    .trim()
    .isLength({ min: 1, max: 128 })
    .withMessage('Secret key is required (max 128 chars).')
    .matches(/^[A-Za-z_][A-Za-z0-9_]*$/)
    .withMessage('Secret key must be a valid env var name (letters, digits, underscore; not starting with a digit).'),
  body('value')
    .isLength({ min: 1, max: 8192 })
    .withMessage('Secret value is required (max 8192 chars).'),
];

// Helper to normalise express-validator output -----------------------------

function collectErrors(req) {
  const result = validationResult(req);
  if (result.isEmpty()) return null;
  return result.array().map((e) => e.msg);
}

/**
 * Turn the parallel step_name[]/step_command[] arrays into a clean array of
 * {name, command}, dropping rows where the command is empty.
 */
function buildSteps(req) {
  const names = [].concat(req.body.step_name || []);
  const commands = [].concat(req.body.step_command || []);
  const steps = [];
  for (let i = 0; i < commands.length; i++) {
    const command = String(commands[i] || '').trim();
    if (!command) continue;
    if (command.length > 4000) {
      throw new Error('A deployment step command is too long (max 4000 chars).');
    }
    const name = String(names[i] || `Step ${steps.length + 1}`).trim().slice(0, 80);
    steps.push({ name, command });
  }
  return steps;
}

module.exports = {
  registerRules,
  loginRules,
  serviceRules,
  secretRules,
  collectErrors,
  buildSteps,
};
