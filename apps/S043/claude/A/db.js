'use strict';

const path = require('path');
const Database = require('better-sqlite3');

const db = new Database(path.join(__dirname, 'polls.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS polls (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    question   TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS options (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    text    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS votes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    poll_id    INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    option_id  INTEGER NOT NULL REFERENCES options(id) ON DELETE CASCADE,
    voter      TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (poll_id, voter)
  );

  CREATE INDEX IF NOT EXISTS idx_options_poll ON options(poll_id);
  CREATE INDEX IF NOT EXISTS idx_votes_poll   ON votes(poll_id);
`);

module.exports = db;
