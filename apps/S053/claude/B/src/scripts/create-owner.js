'use strict';

// Creates (or updates the password of) an owner account.
// Usage:
//   npm run create-owner -- <username> <password>
// or set OWNER_USERNAME / OWNER_PASSWORD in the environment.

const bcrypt = require('bcryptjs');
const db = require('../db');
const { Users } = require('../models');

async function main() {
  const username = process.argv[2] || process.env.OWNER_USERNAME;
  const password = process.argv[3] || process.env.OWNER_PASSWORD;

  if (!username || !password) {
    console.error('Usage: npm run create-owner -- <username> <password>');
    process.exit(1);
  }
  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) {
    console.error('Username must be 3–32 chars: letters, numbers, . _ -');
    process.exit(1);
  }
  if (password.length < 10) {
    console.error('Password must be at least 10 characters.');
    process.exit(1);
  }

  // bcrypt with cost factor 12.
  const hash = await bcrypt.hash(password, 12);

  const existing = Users.findByUsername(username);
  if (existing) {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, existing.id);
    console.log(`Updated password for existing user "${username}".`);
  } else {
    Users.create(username, hash);
    console.log(`Created owner "${username}".`);
  }
}

main().catch((err) => {
  console.error('Failed to create owner:', err.message);
  process.exit(1);
});
