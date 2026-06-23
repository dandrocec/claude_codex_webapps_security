'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STORAGE_DIR = path.join(__dirname, '..', 'storage');

// Ensure directories exist before opening the database / writing files.
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(STORAGE_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// --- Schema --------------------------------------------------------------
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS groups (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS folders (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id  INTEGER REFERENCES folders(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documents (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  name               TEXT NOT NULL,
  folder_id          INTEGER REFERENCES folders(id) ON DELETE CASCADE,
  owner_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  current_version_id INTEGER,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS document_versions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id    INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  stored_name    TEXT NOT NULL,           -- file name on disk inside storage/
  original_name  TEXT NOT NULL,
  mime_type      TEXT,
  size           INTEGER NOT NULL DEFAULT 0,
  uploaded_by    INTEGER NOT NULL REFERENCES users(id),
  note           TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Shares apply to either a 'document' or a 'folder'. Folder shares cascade
-- to every document inside that folder (and its sub-folders).
CREATE TABLE IF NOT EXISTS shares (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  resource_type  TEXT NOT NULL CHECK (resource_type IN ('document','folder')),
  resource_id    INTEGER NOT NULL,
  principal_type TEXT NOT NULL CHECK (principal_type IN ('user','group')),
  principal_id   INTEGER NOT NULL,
  permission     TEXT NOT NULL CHECK (permission IN ('view','edit')),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (resource_type, resource_id, principal_type, principal_id)
);

CREATE INDEX IF NOT EXISTS idx_documents_folder ON documents(folder_id);
CREATE INDEX IF NOT EXISTS idx_versions_document ON document_versions(document_id);
CREATE INDEX IF NOT EXISTS idx_shares_resource ON shares(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_shares_principal ON shares(principal_type, principal_id);
`);

module.exports = { db, DATA_DIR, STORAGE_DIR };
