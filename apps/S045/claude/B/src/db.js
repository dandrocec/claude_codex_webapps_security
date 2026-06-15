'use strict';

const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { DATA_DIR, UPLOAD_DIR, DB_PATH } = require('./config');

// Ensure the data and upload directories exist before opening the database.
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);

// Pragmas: WAL for concurrency, enforce foreign keys.
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS files (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id      INTEGER NOT NULL,
    stored_name   TEXT    NOT NULL UNIQUE,
    original_name TEXT    NOT NULL,
    mime_type     TEXT    NOT NULL,
    size_bytes    INTEGER NOT NULL,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_files_owner ON files(owner_id);
`);

// --- Prepared statements --------------------------------------------------
// Every query that takes user-supplied data uses bound parameters (?), never
// string concatenation — this is our defence against SQL injection.
const statements = {
  insertUser: db.prepare(
    'INSERT INTO users (username, password_hash) VALUES (?, ?)'
  ),
  findUserByUsername: db.prepare(
    'SELECT id, username, password_hash FROM users WHERE username = ?'
  ),
  findUserById: db.prepare('SELECT id, username FROM users WHERE id = ?'),

  insertFile: db.prepare(
    `INSERT INTO files (owner_id, stored_name, original_name, mime_type, size_bytes)
     VALUES (?, ?, ?, ?, ?)`
  ),
  listFilesByOwner: db.prepare(
    `SELECT id, original_name, mime_type, size_bytes, created_at
     FROM files WHERE owner_id = ? ORDER BY created_at DESC, id DESC`
  ),
  // Ownership is part of the WHERE clause: a row is only returned/affected when
  // it belongs to the requesting user. This prevents IDOR.
  findFileForOwner: db.prepare(
    `SELECT id, owner_id, stored_name, original_name, mime_type, size_bytes
     FROM files WHERE id = ? AND owner_id = ?`
  ),
  deleteFileForOwner: db.prepare(
    'DELETE FROM files WHERE id = ? AND owner_id = ?'
  ),
};

module.exports = { db, statements };
