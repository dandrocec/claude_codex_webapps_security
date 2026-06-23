'use strict';

const crypto = require('crypto');
const path = require('path');

// Load environment variables from .env if present. Secrets are NEVER hardcoded.
require('dotenv').config();

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';

let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  if (isProduction) {
    // Refuse to start in production without an explicit secret.
    console.error(
      'FATAL: SESSION_SECRET environment variable is required in production.'
    );
    process.exit(1);
  }
  // Development convenience only: generate an ephemeral secret so the app
  // runs out of the box. Sessions will not survive a restart. Set
  // SESSION_SECRET in .env for stable dev sessions.
  sessionSecret = crypto.randomBytes(48).toString('hex');
  console.warn(
    '[config] SESSION_SECRET not set; using a random ephemeral secret for this run.'
  );
}

// Secure cookies require HTTPS. Forced on in production; configurable in dev.
const cookieSecure = isProduction
  ? true
  : String(process.env.COOKIE_SECURE || '').toLowerCase() === 'true';

module.exports = {
  NODE_ENV,
  isProduction,
  port: parseInt(process.env.PORT, 10) || 5071,
  sessionSecret,
  cookieSecure,
  databaseFile: path.resolve(
    process.env.DATABASE_FILE || path.join(__dirname, '..', 'data', 'auction.db')
  ),
};
