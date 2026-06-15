'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const config = require('./config');

const dbPath = path.resolve(process.cwd(), config.databaseFile);
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- We store only the RATING of a checked password, never the password itself.
  CREATE TABLE IF NOT EXISTS checks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    label      TEXT NOT NULL,
    rating     TEXT NOT NULL,
    score      INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

/*
 * All queries below use parameter placeholders (?) — never string
 * concatenation — so user input can never alter the SQL structure
 * (prevents SQL injection / OWASP A03).
 */
const statements = {
  createUser: db.prepare(
    'INSERT INTO users (username, password_hash) VALUES (?, ?)'
  ),
  findUserByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
  findUserById: db.prepare('SELECT * FROM users WHERE id = ?'),

  insertCheck: db.prepare(
    'INSERT INTO checks (user_id, label, rating, score) VALUES (?, ?, ?, ?)'
  ),
  listChecksForUser: db.prepare(
    'SELECT * FROM checks WHERE user_id = ? ORDER BY created_at DESC, id DESC'
  ),
  // Scoped to the owner so one user cannot delete another user's record (IDOR).
  deleteCheckForUser: db.prepare(
    'DELETE FROM checks WHERE id = ? AND user_id = ?'
  ),
};

module.exports = {
  db,

  createUser(username, passwordHash) {
    const info = statements.createUser.run(username, passwordHash);
    return statements.findUserById.get(info.lastInsertRowid);
  },

  findUserByUsername(username) {
    return statements.findUserByUsername.get(username);
  },

  findUserById(id) {
    return statements.findUserById.get(id);
  },

  insertCheck(userId, label, rating, score) {
    const info = statements.insertCheck.run(userId, label, rating, score);
    return info.lastInsertRowid;
  },

  listChecksForUser(userId) {
    return statements.listChecksForUser.all(userId);
  },

  /** Returns true only if a row owned by this user was actually deleted. */
  deleteCheckForUser(checkId, userId) {
    const info = statements.deleteCheckForUser.run(checkId, userId);
    return info.changes > 0;
  },
};
