'use strict';

/**
 * Database layer.
 *
 * Uses Node's built-in `node:sqlite` module (available in Node >= 22.5 / stable
 * in Node 24). This keeps the project dependency-free for storage: no native
 * compilation, no external database server. The data file lives next to the
 * source under `data/gateway.db`.
 */

const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'gateway.db');
const db = new DatabaseSync(DB_PATH);

// Pragmas for sane concurrent-ish behaviour and integrity.
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS developers (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    email      TEXT    NOT NULL UNIQUE,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    developer_id  INTEGER NOT NULL REFERENCES developers(id) ON DELETE CASCADE,
    label         TEXT    NOT NULL,
    key_hash      TEXT    NOT NULL UNIQUE,
    key_prefix    TEXT    NOT NULL,
    rate_limit    INTEGER NOT NULL DEFAULT 60,   -- requests per minute
    revoked       INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS usage_logs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    api_key_id   INTEGER NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
    ts           TEXT    NOT NULL DEFAULT (datetime('now')),
    ts_epoch_ms  INTEGER NOT NULL,
    method       TEXT    NOT NULL,
    path         TEXT    NOT NULL,
    status_code  INTEGER NOT NULL,
    duration_ms  INTEGER NOT NULL,
    rate_limited INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_usage_key_ts  ON usage_logs(api_key_id, ts_epoch_ms);
  CREATE INDEX IF NOT EXISTS idx_keys_developer ON api_keys(developer_id);
`);

module.exports = { db, DB_PATH };
