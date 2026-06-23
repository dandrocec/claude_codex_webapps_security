'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const dbPath = path.join(DATA_DIR, 'dashboard.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'viewer',  -- 'viewer' | 'operator'
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS services (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  repo_url    TEXT,
  steps       TEXT NOT NULL DEFAULT '[]',        -- JSON: [{ name, command }]
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS secrets (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id      INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  key             TEXT NOT NULL,
  value_encrypted TEXT NOT NULL,                  -- base64 ciphertext
  iv              TEXT NOT NULL,                  -- base64 iv
  tag             TEXT NOT NULL,                  -- base64 auth tag
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (service_id, key)
);

CREATE TABLE IF NOT EXISTS deployments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id   INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending',   -- pending|running|success|failed
  triggered_by INTEGER REFERENCES users(id),
  started_at   TEXT,
  finished_at  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  deployment_id INTEGER NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  ts            TEXT NOT NULL DEFAULT (datetime('now')),
  stream        TEXT NOT NULL,                    -- stdout|stderr|system
  line          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_logs_deployment ON logs(deployment_id, id);
CREATE INDEX IF NOT EXISTS idx_deployments_service ON deployments(service_id, id);
CREATE INDEX IF NOT EXISTS idx_secrets_service ON secrets(service_id);
`);

module.exports = db;
