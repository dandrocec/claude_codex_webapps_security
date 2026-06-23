'use strict';

/**
 * Centralised configuration. Every sensitive value is read from the
 * environment — there are no hardcoded secrets.
 *
 * A minimal .env loader is included so the app is runnable without adding a
 * dotenv dependency. It does NOT override variables already set in the real
 * environment (those win), and it never logs values.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function loadDotEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Strip optional surrounding quotes.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadDotEnv();

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProd = NODE_ENV === 'production';

function requireInProd(name, value) {
  if (isProd && (!value || value.trim() === '')) {
    // eslint-disable-next-line no-console
    console.error(
      `[config] ${name} must be set in production. Refusing to start with an insecure default.`
    );
    process.exit(1);
  }
}

requireInProd('SESSION_SECRET', process.env.SESSION_SECRET);
requireInProd('SECRETS_KEY', process.env.SECRETS_KEY);

// Session secret: required in prod; in dev we generate an ephemeral one
// (sessions won't survive a restart, which is acceptable for local dev).
let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  sessionSecret = crypto.randomBytes(48).toString('hex');
  // eslint-disable-next-line no-console
  console.warn(
    '[config] SESSION_SECRET not set — using an ephemeral dev secret. ' +
      'Set SESSION_SECRET in .env for stable sessions.'
  );
}

// Encryption key for secrets at rest. Must decode to exactly 32 bytes.
let secretsKey;
if (process.env.SECRETS_KEY) {
  secretsKey = decodeKey(process.env.SECRETS_KEY);
  if (!secretsKey) {
    // eslint-disable-next-line no-console
    console.error(
      '[config] SECRETS_KEY must be 32 bytes encoded as 64 hex chars or base64.'
    );
    process.exit(1);
  }
} else {
  secretsKey = crypto.randomBytes(32);
  // eslint-disable-next-line no-console
  console.warn(
    '[config] SECRETS_KEY not set — using an ephemeral dev key. ' +
      'Stored secrets will be UNREADABLE after a restart. ' +
      'Set SECRETS_KEY in .env to persist them.'
  );
}

function decodeKey(raw) {
  const trimmed = raw.trim();
  // Try hex first (64 chars), then base64.
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }
  try {
    const buf = Buffer.from(trimmed, 'base64');
    if (buf.length === 32) return buf;
  } catch {
    /* ignore */
  }
  return null;
}

function boolEnv(name, fallback) {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return v === '1' || v.toLowerCase() === 'true';
}

module.exports = {
  nodeEnv: NODE_ENV,
  isProd,
  port: Number(process.env.PORT) || 5100,
  sessionSecret,
  secretsKey,
  cookieSecure: boolEnv('COOKIE_SECURE', isProd),
  trustProxy: Number(process.env.TRUST_PROXY) || 0,
  dataDir: path.join(__dirname, '..', 'data'),
};
