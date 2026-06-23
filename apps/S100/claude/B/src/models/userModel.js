'use strict';

const bcrypt = require('bcryptjs');
const { db } = require('../db');

const BCRYPT_ROUNDS = 12;

const insertStmt = db.prepare(
  'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)'
);
const byIdStmt = db.prepare('SELECT * FROM users WHERE id = ?');
const byUsernameStmt = db.prepare('SELECT * FROM users WHERE username = ?');

function create({ username, password, role }) {
  const hash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
  const info = insertStmt.run(username, hash, role);
  return findById(info.lastInsertRowid);
}

function findById(id) {
  return byIdStmt.get(id);
}

function findByUsername(username) {
  return byUsernameStmt.get(username);
}

/**
 * Verify a login attempt. Always runs a bcrypt comparison (against a real or
 * dummy hash) to avoid leaking whether a username exists via timing.
 */
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_ROUNDS);

function verifyCredentials(username, password) {
  const user = findByUsername(username);
  const hash = user ? user.password_hash : DUMMY_HASH;
  const ok = bcrypt.compareSync(password, hash);
  return ok && user ? user : null;
}

module.exports = { create, findById, findByUsername, verifyCredentials };
