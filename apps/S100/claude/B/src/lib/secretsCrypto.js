'use strict';

/**
 * Authenticated encryption for service secrets at rest using AES-256-GCM.
 * The key comes from config (SECRETS_KEY env var). Each value gets a fresh
 * random 96-bit IV, and the GCM auth tag is stored so tampering is detected
 * on decrypt.
 */

const crypto = require('crypto');
const config = require('../config');

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit nonce recommended for GCM

function encrypt(plaintext) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, config.secretsKey, iv);
  const ciphertext = Buffer.concat([
    cipher.update(String(plaintext), 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

function decrypt({ ciphertext, iv, authTag }) {
  const decipher = crypto.createDecipheriv(
    ALGO,
    config.secretsKey,
    Buffer.from(iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

module.exports = { encrypt, decrypt };
