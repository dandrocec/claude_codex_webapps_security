'use strict';

const db = require('../db');

// All statements use bound parameters (?) — never string interpolation —
// so user input can never be interpreted as SQL.
const insertStmt = db.prepare(
  'INSERT INTO users (username, password_hash) VALUES (?, ?)'
);
const byUsernameStmt = db.prepare('SELECT * FROM users WHERE username = ?');
const byIdStmt = db.prepare('SELECT id, username, created_at FROM users WHERE id = ?');

function create(username, passwordHash) {
  const info = insertStmt.run(username, passwordHash);
  return info.lastInsertRowid;
}

function findByUsername(username) {
  return byUsernameStmt.get(username);
}

function findById(id) {
  return byIdStmt.get(id);
}

module.exports = { create, findByUsername, findById };
