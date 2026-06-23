'use strict';

require('dotenv').config();

/**
 * Centralised, validated configuration.
 *
 * Secrets are ONLY read from environment variables (never hardcoded). The app
 * refuses to start if a required secret is missing or obviously weak, so we
 * fail closed instead of running with insecure defaults.
 */

function required(name) {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function bool(name, fallback) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

const isProduction = process.env.NODE_ENV === 'production';

// Encryption key for AES-256-GCM must be exactly 32 bytes (64 hex chars).
const encryptionKeyHex = required('ENCRYPTION_KEY');
if (!/^[0-9a-fA-F]{64}$/.test(encryptionKeyHex)) {
  throw new Error('ENCRYPTION_KEY must be 64 hex characters (32 bytes).');
}

const sessionSecret = required('SESSION_SECRET');
if (sessionSecret.length < 32) {
  throw new Error('SESSION_SECRET must be at least 32 characters long.');
}

const config = {
  isProduction,
  port: Number(process.env.PORT) || 5090,

  // Session cookie is only sent over HTTPS when COOKIE_SECURE=true. In
  // production we force it on regardless to avoid an insecure misconfiguration.
  cookieSecure: isProduction ? true : bool('COOKIE_SECURE', false),

  sessionSecret,
  encryptionKey: Buffer.from(encryptionKeyHex, 'hex'),

  github: {
    clientID: required('GITHUB_CLIENT_ID'),
    clientSecret: required('GITHUB_CLIENT_SECRET'),
    callbackURL: required('OAUTH_CALLBACK_URL'),
    // Least-privilege scopes: read basic profile + email only. This is enough
    // to list the user's public repositories via the API; we deliberately do
    // NOT request the broad `repo` scope (which grants private read/write).
    scope: ['read:user', 'user:email'],
  },

  dataDir: require('path').join(__dirname, '..', 'data'),
};

module.exports = config;
