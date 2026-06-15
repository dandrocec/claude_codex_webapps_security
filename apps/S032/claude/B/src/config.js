'use strict';

const crypto = require('crypto');

const isProduction = process.env.NODE_ENV === 'production';

// Secrets must come from the environment — never hardcoded.
let sessionSecret = process.env.SESSION_SECRET;

if (!sessionSecret) {
  if (isProduction) {
    // Refuse to start insecurely in production.
    throw new Error(
      'SESSION_SECRET environment variable is required in production.'
    );
  }
  // Development convenience only: generate an ephemeral secret so the app runs,
  // but warn loudly. Sessions will not survive a restart.
  sessionSecret = crypto.randomBytes(48).toString('hex');
  // eslint-disable-next-line no-console
  console.warn(
    '[config] SESSION_SECRET not set — using a temporary random secret. ' +
      'Set SESSION_SECRET in your .env for stable sessions.'
  );
}

module.exports = {
  isProduction,
  port: Number(process.env.PORT) || 5032,
  sessionSecret,
  // Allowed expense categories. Used for server-side validation (whitelist).
  categories: [
    'Food',
    'Transport',
    'Housing',
    'Utilities',
    'Health',
    'Entertainment',
    'Shopping',
    'Other',
  ],
};
