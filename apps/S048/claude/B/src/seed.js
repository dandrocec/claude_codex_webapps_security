'use strict';

// Creates (or updates) the reviewer login from environment variables.
// Run with:  npm run seed
require('dotenv').config();

const bcrypt = require('bcrypt');
const db = require('./db');

const username = process.env.REVIEWER_USERNAME;
const password = process.env.REVIEWER_PASSWORD;

if (!username || !password) {
  console.error('REVIEWER_USERNAME and REVIEWER_PASSWORD must be set in .env');
  process.exit(1);
}

if (password.length < 10) {
  console.error('REVIEWER_PASSWORD must be at least 10 characters.');
  process.exit(1);
}

const BCRYPT_ROUNDS = 12;
const hash = bcrypt.hashSync(password, BCRYPT_ROUNDS);

const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
if (existing) {
  db.prepare('UPDATE users SET password_hash = ?, role = ? WHERE id = ?')
    .run(hash, 'reviewer', existing.id);
  console.log(`Updated reviewer account "${username}".`);
} else {
  db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
    .run(username, hash, 'reviewer');
  console.log(`Created reviewer account "${username}".`);
}
