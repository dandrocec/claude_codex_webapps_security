'use strict';

const bcrypt = require('bcryptjs');
const db = require('../db');

const BCRYPT_ROUNDS = 12;

// A valid dummy hash computed once at startup. Used to spend comparable CPU time
// when an email is unknown, so login timing does not reveal whether it exists.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-constant-time', BCRYPT_ROUNDS);

const statements = {
  insert: db.prepare(`
    INSERT INTO users (email, password_hash) VALUES (?, ?)
  `),
  byEmail: db.prepare(`SELECT id, email, password_hash FROM users WHERE email = ?`),
  byId: db.prepare(`SELECT id, email FROM users WHERE id = ?`),
};

async function createUser(email, password) {
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const info = statements.insert.run(email, passwordHash);
  return { id: info.lastInsertRowid, email };
}

function findByEmail(email) {
  return statements.byEmail.get(email) || null;
}

function findById(id) {
  return statements.byId.get(id) || null;
}

async function verifyPassword(user, password) {
  if (!user) {
    // Run a dummy comparison so timing does not reveal whether the email exists.
    await bcrypt.compare(password, DUMMY_HASH);
    return false;
  }
  return bcrypt.compare(password, user.password_hash);
}

function emailExists(email) {
  return Boolean(statements.byEmail.get(email));
}

module.exports = { createUser, findByEmail, findById, verifyPassword, emailExists };
