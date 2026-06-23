'use strict';

const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const isProd = process.env.NODE_ENV === 'production';

// Read the session secret from the environment. In production we refuse to start
// without one so we never ship a predictable/hardcoded secret.
let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret || sessionSecret === 'replace-me-with-a-long-random-value') {
  if (isProd) {
    throw new Error('SESSION_SECRET must be set to a strong random value in production.');
  }
  // Dev fallback: ephemeral secret so the app still runs. Sessions reset on restart.
  sessionSecret = crypto.randomBytes(48).toString('hex');
  // eslint-disable-next-line no-console
  console.warn('[config] SESSION_SECRET not set; using a temporary dev secret.');
}

const projectRoot = path.resolve(__dirname, '..');

function resolveFromRoot(p, fallback) {
  return path.resolve(projectRoot, p || fallback);
}

module.exports = {
  isProd,
  port: parseInt(process.env.PORT, 10) || 5073,
  sessionSecret,
  uploadDir: resolveFromRoot(process.env.UPLOAD_DIR, 'var/uploads'),
  databaseFile: resolveFromRoot(process.env.DATABASE_FILE, 'var/app.db'),
  maxUploadBytes: parseInt(process.env.MAX_UPLOAD_BYTES, 10) || 5 * 1024 * 1024,
  projectRoot,
};
