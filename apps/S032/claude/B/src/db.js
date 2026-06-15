'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// Keep the database (and session store) inside a dedicated data directory.
const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'expense-tracker.sqlite'));

// Pragmas for reliability/concurrency on a local SQLite file.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Schema. `IF NOT EXISTS` makes startup idempotent.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    amount     INTEGER NOT NULL,            -- stored as integer cents to avoid float errors
    category   TEXT    NOT NULL,
    spent_on   TEXT    NOT NULL,            -- ISO date string YYYY-MM-DD
    note       TEXT    NOT NULL DEFAULT '',
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_expenses_user_date
    ON expenses (user_id, spent_on);
`);

module.exports = db;
