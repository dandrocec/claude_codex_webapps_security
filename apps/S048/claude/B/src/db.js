'use strict';

const path = require('path');
const Database = require('better-sqlite3');

// Single shared connection. better-sqlite3 is synchronous which keeps the
// example simple and avoids callback/await noise in route handlers.
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data.sqlite');
const db = new Database(dbPath);

// Reasonable durability/concurrency defaults.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL DEFAULT 'reviewer',
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS feedback (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    category   TEXT    NOT NULL,
    rating     INTEGER NOT NULL,
    comment    TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

module.exports = db;
