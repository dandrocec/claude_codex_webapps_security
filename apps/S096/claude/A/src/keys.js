'use strict';

/**
 * API key generation and verification helpers.
 *
 * A raw key is shown to the developer exactly once at creation time. Only a
 * SHA-256 hash is stored, so a database leak does not expose usable keys.
 */

const crypto = require('node:crypto');

const KEY_PREFIX = 'gw_';

/** Generate a new random key. Returns the raw key (show once) + storage fields. */
function generateKey() {
  const raw = KEY_PREFIX + crypto.randomBytes(24).toString('hex');
  return {
    raw,
    hash: hashKey(raw),
    // A short, non-secret prefix kept in the clear so a key can be visually
    // identified in the dashboard without revealing the full secret.
    prefix: raw.slice(0, 10),
  };
}

function hashKey(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

module.exports = { generateKey, hashKey, KEY_PREFIX };
