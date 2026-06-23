'use strict';

const crypto = require('crypto');
const path = require('path');

require('dotenv').config();

function bool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function int(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

const NODE_ENV = process.env.NODE_ENV || 'development';

// Secrets are read from the environment. Never hardcode them.
// For local convenience we generate an ephemeral secret if none is provided,
// but this means sessions do not survive a restart and is NOT suitable for production.
let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  if (NODE_ENV === 'production') {
    // Fail closed in production rather than running with a weak/ephemeral secret.
    throw new Error('SESSION_SECRET must be set in production.');
  }
  sessionSecret = crypto.randomBytes(48).toString('hex');
  // eslint-disable-next-line no-console
  console.warn(
    '[config] SESSION_SECRET not set; using an ephemeral secret. ' +
      'Set SESSION_SECRET in your environment for stable sessions.'
  );
}

module.exports = {
  nodeEnv: NODE_ENV,
  isProduction: NODE_ENV === 'production',
  port: int(process.env.PORT, 5094),
  sessionSecret,
  cookieSecure: bool(process.env.COOKIE_SECURE, NODE_ENV === 'production'),
  dbPath: process.env.DB_PATH
    ? path.resolve(process.env.DB_PATH)
    : path.resolve(__dirname, '..', 'data', 'hub.db'),
  outbound: {
    timeoutMs: int(process.env.OUTBOUND_TIMEOUT_MS, 5000),
    maxBytes: int(process.env.OUTBOUND_MAX_BYTES, 64 * 1024),
    allowPrivateTargets: bool(process.env.ALLOW_PRIVATE_TARGETS, false),
  },
};
