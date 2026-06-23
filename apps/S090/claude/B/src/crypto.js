'use strict';

const crypto = require('crypto');
const { encryptionKey } = require('./config');

/**
 * Authenticated symmetric encryption (AES-256-GCM) for data at rest.
 *
 * We use this to protect the OAuth provider access token before storing it in
 * the database. Even with read access to the DB file, an attacker cannot use
 * the tokens without the ENCRYPTION_KEY (which lives only in the environment).
 *
 * Output format: base64( iv[12] || authTag[16] || ciphertext )
 */

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

function encrypt(plaintext) {
  if (plaintext === null || plaintext === undefined) return null;
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, encryptionKey, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decrypt(payload) {
  if (payload === null || payload === undefined) return null;
  const raw = Buffer.from(payload, 'base64');
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const data = raw.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, encryptionKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
