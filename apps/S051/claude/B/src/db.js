'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// Keep the database file inside a dedicated data/ directory.
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, 'watchlist.sqlite'));

// Recommended pragmas for safety and concurrency.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Schema. Created once; harmless to run on every startup.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT    NOT NULL,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS movies (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    title      TEXT    NOT NULL,
    year       INTEGER NOT NULL,
    status     TEXT    NOT NULL CHECK (status IN ('to_watch', 'watching', 'watched')),
    rating     INTEGER CHECK (rating IS NULL OR (rating BETWEEN 1 AND 10)),
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_movies_user ON movies(user_id);
`);

module.exports = db;
