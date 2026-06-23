'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dbFile = process.env.DB_FILE
  ? path.resolve(process.env.DB_FILE)
  : path.join(__dirname, '..', 'data', 'ticketing.db');

// Ensure the directory for the database exists.
fs.mkdirSync(path.dirname(dbFile), { recursive: true });

const db = new Database(dbFile);

// Pragmas: WAL improves concurrency, foreign_keys enforces referential integrity.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    organiser_id  INTEGER NOT NULL,
    name          TEXT    NOT NULL,
    description   TEXT    NOT NULL DEFAULT '',
    event_date    TEXT,
    capacity      INTEGER NOT NULL CHECK (capacity > 0),
    tickets_sold  INTEGER NOT NULL DEFAULT 0 CHECK (tickets_sold >= 0),
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (organiser_id) REFERENCES users(id) ON DELETE CASCADE,
    -- Hard guard at the database level: never allow oversell.
    CHECK (tickets_sold <= capacity)
  );

  CREATE TABLE IF NOT EXISTS tickets (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id     INTEGER NOT NULL,
    user_id      INTEGER NOT NULL,
    purchased_at TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_tickets_user  ON tickets(user_id);
  CREATE INDEX IF NOT EXISTS idx_tickets_event ON tickets(event_id);
  CREATE INDEX IF NOT EXISTS idx_events_org    ON events(organiser_id);
`);

module.exports = db;
