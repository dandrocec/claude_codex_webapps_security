'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// Keep the database file in a dedicated data directory so it is easy to back up
// or wipe. The directory is created on first run.
const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'app.sqlite'));

// Pragmas: WAL improves concurrency; foreign_keys enforces ON DELETE CASCADE so
// deleting a user removes their events (and prevents orphaned rows).
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    label      TEXT NOT NULL,
    target_at  TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id);
`);

module.exports = db;
