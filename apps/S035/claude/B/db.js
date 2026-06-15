'use strict';

const path = require('path');
const Database = require('better-sqlite3');

// Database file lives alongside the app. Override with DB_PATH if desired.
const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'habits.db');

// Ensure the parent directory exists.
const fs = require('fs');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);

// Pragmas for integrity and concurrency.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Schema. All access elsewhere uses parameterised prepared statements.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS habits (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    name       TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS checkins (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    habit_id INTEGER NOT NULL,
    day      TEXT    NOT NULL,           -- ISO date 'YYYY-MM-DD'
    FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE,
    UNIQUE (habit_id, day)
  );

  CREATE INDEX IF NOT EXISTS idx_habits_user ON habits(user_id);
  CREATE INDEX IF NOT EXISTS idx_checkins_habit ON checkins(habit_id);
`);

module.exports = db;
