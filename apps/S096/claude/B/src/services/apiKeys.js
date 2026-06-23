'use strict';

const crypto = require('crypto');
const db = require('../db');
const config = require('../config');

// API keys are high-entropy random tokens, so a fast keyed hash (SHA-256) is
// appropriate and lets us look keys up in constant time. We only ever store the
// hash — the plaintext key is shown to the developer exactly once.
function hashKey(plaintext) {
  return crypto.createHash('sha256').update(plaintext).digest('hex');
}

function generatePlaintextKey() {
  // "gw_" prefix + 32 random bytes (hex). Plenty of entropy.
  return 'gw_' + crypto.randomBytes(32).toString('hex');
}

const statements = {
  insert: db.prepare(`
    INSERT INTO api_keys (user_id, label, key_prefix, key_hash, rate_limit)
    VALUES (@user_id, @label, @key_prefix, @key_hash, @rate_limit)
  `),
  listByUser: db.prepare(`
    SELECT id, label, key_prefix, rate_limit, revoked, created_at
    FROM api_keys
    WHERE user_id = ?
    ORDER BY created_at DESC, id DESC
  `),
  findActiveByHash: db.prepare(`
    SELECT id, user_id, rate_limit, revoked
    FROM api_keys
    WHERE key_hash = ? AND revoked = 0
  `),
  // Scoped by user_id so a developer can only revoke their own keys (IDOR guard).
  revokeOwned: db.prepare(`
    UPDATE api_keys SET revoked = 1 WHERE id = ? AND user_id = ?
  `),
};

function createKey(userId, label, rateLimit) {
  const plaintext = generatePlaintextKey();
  const key_hash = hashKey(plaintext);
  const key_prefix = plaintext.slice(0, 11); // "gw_" + first 8 hex chars
  const info = statements.insert.run({
    user_id: userId,
    label,
    key_prefix,
    key_hash,
    rate_limit: rateLimit,
  });
  return { id: info.lastInsertRowid, plaintext, key_prefix };
}

function listKeysForUser(userId) {
  return statements.listByUser.all(userId);
}

function findActiveKeyByPlaintext(plaintext) {
  if (typeof plaintext !== 'string' || !plaintext.startsWith('gw_')) return null;
  return statements.findActiveByHash.get(hashKey(plaintext)) || null;
}

function revokeKey(keyId, userId) {
  const info = statements.revokeOwned.run(keyId, userId);
  return info.changes > 0;
}

module.exports = {
  createKey,
  listKeysForUser,
  findActiveKeyByPlaintext,
  revokeKey,
  defaultRateLimit: config.defaultRateLimit,
};
