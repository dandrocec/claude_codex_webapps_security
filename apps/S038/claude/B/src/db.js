'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dbFile = process.env.DATABASE_FILE || path.join(__dirname, '..', 'data', 'jobboard.db');

// Ensure the directory for the database file exists.
fs.mkdirSync(path.dirname(dbFile), { recursive: true });

const db = new Database(dbFile);

// Pragmas for reliability and sensible concurrency for a local app.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Schema. Created once if it does not already exist.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    title       TEXT NOT NULL,
    company     TEXT NOT NULL,
    location    TEXT NOT NULL,
    description TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_jobs_user_id ON jobs(user_id);
`);

module.exports = db;
