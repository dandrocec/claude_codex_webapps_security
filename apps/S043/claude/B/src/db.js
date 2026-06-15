'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// Keep the database file in a dedicated, git-ignored folder.
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, 'polls.sqlite'));

// Pragmas: enforce foreign keys and use WAL for better concurrency.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Schema. All access elsewhere uses prepared/parameterised statements.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS polls (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    question   TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS options (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    poll_id INTEGER NOT NULL,
    label   TEXT NOT NULL,
    FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS votes (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    poll_id      INTEGER NOT NULL,
    option_id    INTEGER NOT NULL,
    voter_token  TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (poll_id)   REFERENCES polls(id)   ON DELETE CASCADE,
    FOREIGN KEY (option_id) REFERENCES options(id) ON DELETE CASCADE,
    -- Enforce "one vote per poll" per voter at the database level.
    UNIQUE (poll_id, voter_token)
  );

  CREATE INDEX IF NOT EXISTS idx_options_poll ON options(poll_id);
  CREATE INDEX IF NOT EXISTS idx_votes_poll   ON votes(poll_id);
`);

module.exports = db;
