'use strict';

// Load environment variables from .env (no-op if the file is absent).
require('dotenv').config();

const path = require('path');

function bool(value, fallback) {
  if (value === undefined) return fallback;
  return String(value).toLowerCase() === 'true';
}

const isProduction = process.env.NODE_ENV === 'production';

// SESSION_SECRET must never be hardcoded. In production we refuse to start
// without it so we never silently fall back to a predictable signing key.
let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  if (isProduction) {
    // eslint-disable-next-line no-console
    console.error('FATAL: SESSION_SECRET environment variable is required in production.');
    process.exit(1);
  }
  // Development-only ephemeral secret so the app is runnable out of the box.
  // Sessions will not survive a restart, which is acceptable for local dev.
  sessionSecret = require('crypto').randomBytes(48).toString('hex');
  // eslint-disable-next-line no-console
  console.warn('WARNING: SESSION_SECRET not set. Using a random ephemeral secret (dev only).');
}

module.exports = {
  isProduction,
  port: Number(process.env.PORT) || 5041,
  sessionSecret,
  cookieSecure: bool(process.env.COOKIE_SECURE, isProduction),
  databaseFile: path.resolve(
    process.cwd(),
    process.env.DATABASE_FILE || './data/faq.db'
  ),
  seedAdminUsername: process.env.SEED_ADMIN_USERNAME || 'editor',
  seedAdminPassword: process.env.SEED_ADMIN_PASSWORD || '',
};
