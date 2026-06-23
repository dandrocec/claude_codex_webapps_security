'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// AES-256-GCM encryption for secrets at rest.
//
// The master key comes from SECRET_KEY (32-byte value, hex or base64). If not
// provided, a key is generated once and persisted to data/secret.key so the app
// stays runnable out of the box. In production, set SECRET_KEY yourself and keep
// it out of the data directory.

const DATA_DIR = path.join(__dirname, '..', 'data');
const KEY_FILE = path.join(DATA_DIR, 'secret.key');

function loadKey() {
  const fromEnv = process.env.SECRET_KEY;
  if (fromEnv) {
    const buf = decodeKey(fromEnv);
    if (buf.length !== 32) {
      throw new Error('SECRET_KEY must decode to exactly 32 bytes (hex or base64).');
    }
    return buf;
  }

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(KEY_FILE)) {
    return Buffer.from(fs.readFileSync(KEY_FILE, 'utf8').trim(), 'hex');
  }

  const key = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, key.toString('hex'), { mode: 0o600 });
  return key;
}

function decodeKey(value) {
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, 'hex');
  return Buffer.from(value, 'base64');
}

const KEY = loadKey();

function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    value_encrypted: enc.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

function decrypt({ value_encrypted, iv, tag }) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(value_encrypted, 'base64')),
    decipher.final(),
  ]);
  return dec.toString('utf8');
}

module.exports = { encrypt, decrypt };
