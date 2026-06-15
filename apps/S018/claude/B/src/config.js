'use strict';

const crypto = require('crypto');

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Resolve the session secret.
 * - In production it MUST come from the environment (never hardcoded).
 * - In development we fall back to a random ephemeral secret so the app is
 *   runnable out of the box, with a clear warning.
 */
function resolveSessionSecret() {
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv && fromEnv.length >= 16) {
    return fromEnv;
  }

  if (isProduction) {
    throw new Error(
      'SESSION_SECRET environment variable is required (>=16 chars) in production.'
    );
  }

  // eslint-disable-next-line no-console
  console.warn(
    '[warning] SESSION_SECRET not set — generating a temporary development secret. ' +
      'Sessions will reset on restart. Set SESSION_SECRET in your .env for stable sessions.'
  );
  return crypto.randomBytes(48).toString('hex');
}

module.exports = {
  isProduction,
  port: Number(process.env.PORT) || 5018,
  sessionSecret: resolveSessionSecret(),
  databaseFile: process.env.DATABASE_FILE || './data/app.db',
};
