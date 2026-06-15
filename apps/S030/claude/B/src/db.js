'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// Keep the database file in a dedicated ./data directory.
const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'bookmarks.sqlite'));

// Recommended pragmas for safety and concurrency.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Schema. Bookmarks belong to a user (FK with cascade delete).
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
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
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks(user_id);
`);

module.exports = db;
