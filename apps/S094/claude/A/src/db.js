'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'hub.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS webhooks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    slug        TEXT NOT NULL UNIQUE,
    secret      TEXT,                       -- optional shared secret for HMAC verification
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS actions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    webhook_id    INTEGER NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
    target_url    TEXT NOT NULL,            -- user-supplied URL to call
    method        TEXT NOT NULL DEFAULT 'POST',
    headers_json  TEXT NOT NULL DEFAULT '{}',
    enabled       INTEGER NOT NULL DEFAULT 1,
    max_attempts  INTEGER NOT NULL DEFAULT 5,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    webhook_id    INTEGER NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
    payload       TEXT NOT NULL,            -- raw inbound body
    headers_json  TEXT NOT NULL DEFAULT '{}',
    source_ip     TEXT,
    received_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS deliveries (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id       INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    action_id      INTEGER NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
    target_url     TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'pending',  -- pending | success | failed
    attempts       INTEGER NOT NULL DEFAULT 0,
    max_attempts   INTEGER NOT NULL DEFAULT 5,
    last_status    INTEGER,
    last_error     TEXT,
    response_body  TEXT,
    next_attempt_at TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_events_received   ON events(received_at DESC);
  CREATE INDEX IF NOT EXISTS idx_deliveries_status ON deliveries(status, next_attempt_at);
  CREATE INDEX IF NOT EXISTS idx_actions_webhook   ON actions(webhook_id);
`);

module.exports = db;
