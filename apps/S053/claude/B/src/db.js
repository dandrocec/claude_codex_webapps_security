'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

// Ensure the directory for the database file exists.
const dbDir = path.dirname(config.databasePath);
fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(config.databasePath);

// Pragmas for integrity and concurrency.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Schema. Created once; safe to run repeatedly.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS projects (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id    INTEGER NOT NULL,
    title       TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    link        TEXT    NOT NULL DEFAULT '',
    image_url   TEXT    NOT NULL DEFAULT '',
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id);
`);

module.exports = db;
