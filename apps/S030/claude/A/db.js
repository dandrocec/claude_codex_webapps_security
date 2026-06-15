'use strict';

const path = require('path');
const Database = require('better-sqlite3');

// The SQLite file lives next to this module. Delete it to reset all data.
const db = new Database(path.join(__dirname, 'data.sqlite'));

// Recommended pragmas for a small web app.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS bookmarks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    title      TEXT NOT NULL,
    url        TEXT NOT NULL,
    tags       TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks(user_id);
`);

module.exports = db;
