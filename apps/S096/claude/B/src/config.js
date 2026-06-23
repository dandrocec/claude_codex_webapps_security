'use strict';

const path = require('path');
require('dotenv').config();

const isProd = process.env.NODE_ENV === 'production';

// Secrets must come from the environment — never hardcoded.
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  if (isProd) {
    throw new Error('SESSION_SECRET environment variable is required in production.');
  }
  // Allow a throwaway secret in development only, but make the risk obvious.
  // eslint-disable-next-line no-console
  console.warn(
    '[config] SESSION_SECRET is not set. Using an insecure development secret. ' +
      'Set SESSION_SECRET in your .env before deploying.'
  );
}

function int(name, fallback) {
  const raw = process.env[name];
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

module.exports = {
  isProd,
  port: int('PORT', 5096),
  sessionSecret: sessionSecret || 'insecure-development-secret-do-not-use-in-production',
  cookieSecure: (process.env.COOKIE_SECURE || (isProd ? 'true' : 'false')) === 'true',
  backendUrl: (process.env.BACKEND_URL || 'https://httpbin.org').replace(/\/+$/, ''),
  defaultRateLimit: int('DEFAULT_RATE_LIMIT', 60),
  rateWindowMs: 60 * 1000,
  dbPath: process.env.DB_PATH
    ? path.resolve(process.env.DB_PATH)
    : path.join(__dirname, '..', 'data', 'gateway.db'),
};
