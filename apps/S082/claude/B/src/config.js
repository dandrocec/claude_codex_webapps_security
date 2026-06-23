'use strict';

const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const ROOT = path.resolve(__dirname, '..');

// Secrets must never be hardcoded. Require a strong secret in production-like
// runs; fall back to a per-process random value only so first-time local dev
// does not crash (sessions reset on restart, which is acceptable for dev).
let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET environment variable is required in production.');
  }
  // eslint-disable-next-line no-console
  console.warn('[config] SESSION_SECRET not set; generating an ephemeral dev secret.');
  sessionSecret = crypto.randomBytes(48).toString('hex');
}

const config = {
  root: ROOT,
  port: parseInt(process.env.PORT, 10) || 5082,
  sessionSecret,
  cookieSecure: String(process.env.COOKIE_SECURE).toLowerCase() === 'true',
  maxUploadBytes: parseInt(process.env.MAX_UPLOAD_BYTES, 10) || 10 * 1024 * 1024,
  dataDir: path.join(ROOT, 'data'),
  uploadDir: path.join(ROOT, 'uploads'),
  dbPath: path.join(ROOT, 'data', 'app.db'),
};

module.exports = config;
