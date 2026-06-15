'use strict';

const path = require('path');
const Database = require('better-sqlite3');

const db = new Database(path.join(__dirname, 'data.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS habits (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- One row per habit per day it was ticked off. day is stored as 'YYYY-MM-DD'.
  CREATE TABLE IF NOT EXISTS checkins (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    habit_id INTEGER NOT NULL,
    day      TEXT NOT NULL,
    UNIQUE (habit_id, day),
    FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE
  );
`);

module.exports = db;
