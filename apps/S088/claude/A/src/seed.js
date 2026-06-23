'use strict';

// Optional convenience: create two demo users so you can test sharing
// without registering twice. Run with: npm run seed
const bcrypt = require('bcryptjs');
const { db } = require('./db');

function ensureUser(username, password) {
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return existing.id;
  const info = db
    .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .run(username, bcrypt.hashSync(password, 10));
  return info.lastInsertRowid;
}

const alice = ensureUser('alice', 'password');
const bob = ensureUser('bob', 'password');

console.log('Seeded demo users:');
console.log(`  alice / password  (id ${alice})`);
console.log(`  bob   / password  (id ${bob})`);
