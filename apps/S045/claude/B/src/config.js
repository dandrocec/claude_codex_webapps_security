'use strict';

const crypto = require('node:crypto');
const path = require('node:path');

// Load environment variables from .env if present (no-op if the file is absent).
require('dotenv').config();

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';

// --- Session secret -------------------------------------------------------
// Read from the environment; never hardcode. In production we refuse to start
// without it. In development we fall back to an ephemeral random secret so the
// app is runnable out of the box (sessions reset on restart).
let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  if (isProduction) {
    // eslint-disable-next-line no-console
    console.error('FATAL: SESSION_SECRET must be set in production.');
    process.exit(1);
  }
  sessionSecret = crypto.randomBytes(48).toString('hex');
  // eslint-disable-next-line no-console
  console.warn(
    '[config] SESSION_SECRET not set — using a random ephemeral secret ' +
      '(development only). Sessions will not survive a restart.'
  );
}

const PORT = Number.parseInt(process.env.PORT || '5045', 10);

const MAX_UPLOAD_BYTES = Number.parseInt(
  process.env.MAX_UPLOAD_BYTES || String(10 * 1024 * 1024),
  10
);

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_PATH = path.join(DATA_DIR, 'app.db');

module.exports = {
  NODE_ENV,
  isProduction,
  PORT,
  sessionSecret,
  MAX_UPLOAD_BYTES,
  DATA_DIR,
  UPLOAD_DIR,
  DB_PATH,
};
