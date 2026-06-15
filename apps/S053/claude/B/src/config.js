'use strict';

require('dotenv').config();

const path = require('path');

function requireSecret(name) {
  const value = process.env[name];
  if (!value || value.trim() === '' || value === 'replace-with-a-long-random-secret') {
    // Fail fast: never fall back to a hardcoded/default secret.
    throw new Error(
      `Missing required environment variable "${name}". ` +
        `Copy .env.example to .env and set a strong value.`
    );
  }
  return value;
}

const config = {
  port: parseInt(process.env.PORT, 10) || 5053,
  env: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  sessionSecret: requireSecret('SESSION_SECRET'),
  // Secure cookies require HTTPS. Allow an explicit override for HTTPS dev/prod.
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  databasePath: process.env.DATABASE_PATH
    ? path.resolve(process.env.DATABASE_PATH)
    : path.resolve(__dirname, '..', 'data', 'portfolio.db'),
};

module.exports = config;
