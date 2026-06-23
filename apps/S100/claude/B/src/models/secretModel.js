'use strict';

const { db } = require('../db');
const { encrypt, decrypt } = require('../lib/secretsCrypto');

const upsertStmt = db.prepare(
  `INSERT INTO secrets (service_id, key, ciphertext, iv, auth_tag)
   VALUES (@service_id, @key, @ciphertext, @iv, @auth_tag)
   ON CONFLICT(service_id, key) DO UPDATE SET
     ciphertext = excluded.ciphertext,
     iv         = excluded.iv,
     auth_tag   = excluded.auth_tag`
);
const listStmt = db.prepare(
  'SELECT id, key, created_at FROM secrets WHERE service_id = ? ORDER BY key'
);
const allForServiceStmt = db.prepare(
  'SELECT key, ciphertext, iv, auth_tag FROM secrets WHERE service_id = ?'
);
const deleteStmt = db.prepare(
  'DELETE FROM secrets WHERE service_id = ? AND id = ?'
);

function setSecret(serviceId, key, value) {
  const enc = encrypt(value);
  upsertStmt.run({
    service_id: serviceId,
    key,
    ciphertext: enc.ciphertext,
    iv: enc.iv,
    auth_tag: enc.authTag,
  });
}

/** Returns metadata only (keys + timestamps). Never exposes values. */
function listKeys(serviceId) {
  return listStmt.all(serviceId);
}

/** Decrypts all secrets for injection into a deployment process. */
function getDecryptedMap(serviceId) {
  const out = {};
  for (const row of allForServiceStmt.all(serviceId)) {
    out[row.key] = decrypt({
      ciphertext: row.ciphertext,
      iv: row.iv,
      authTag: row.auth_tag,
    });
  }
  return out;
}

function removeSecret(serviceId, secretId) {
  deleteStmt.run(serviceId, secretId);
}

module.exports = { setSecret, listKeys, getDecryptedMap, removeSecret };
