'use strict';

const path = require('path');
const Database = require('better-sqlite3');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data.db');

const db = new Database(dbPath);

// Safer defaults.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Schema. All access to these tables goes through parameterised prepared
// statements (see src/repositories.js) — never string concatenation.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS documents (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    content     TEXT    NOT NULL DEFAULT '',
    owner_id    INTEGER NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS document_access (
    document_id INTEGER NOT NULL,
    user_id     INTEGER NOT NULL,
    permission  TEXT    NOT NULL CHECK (permission IN ('view', 'edit')),
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (document_id, user_id),
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id)     REFERENCES users(id)     ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_access_user ON document_access(user_id);
  CREATE INDEX IF NOT EXISTS idx_documents_owner ON documents(owner_id);
`);

module.exports = db;
