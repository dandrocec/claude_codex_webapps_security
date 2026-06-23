'use strict';

/**
 * Database access layer.
 *
 * Uses better-sqlite3. Every query that touches user-controlled data uses
 * bound parameters (prepared statements) — no string concatenation of SQL —
 * which prevents SQL injection.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');

if (!fs.existsSync(config.dataDir)) {
  fs.mkdirSync(config.dataDir, { recursive: true });
}

const dbPath = path.join(config.dataDir, 'app.db');
const db = new Database(dbPath);

// Pragmas for integrity and concurrency.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL CHECK (role IN ('viewer','operator')),
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS services (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      repo_url    TEXT,
      description TEXT,
      steps       TEXT NOT NULL DEFAULT '[]',  -- JSON array of {name, command}
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_services_owner ON services(owner_id);

    CREATE TABLE IF NOT EXISTS secrets (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id  INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      key         TEXT NOT NULL,
      ciphertext  TEXT NOT NULL,  -- base64
      iv          TEXT NOT NULL,  -- base64
      auth_tag    TEXT NOT NULL,  -- base64
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (service_id, key)
    );

    CREATE TABLE IF NOT EXISTS deployments (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id   INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      triggered_by INTEGER NOT NULL REFERENCES users(id) ON DELETE SET NULL,
      status       TEXT NOT NULL DEFAULT 'running'
                     CHECK (status IN ('running','success','failed')),
      started_at   TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_deployments_service ON deployments(service_id);

    CREATE TABLE IF NOT EXISTS logs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      deployment_id INTEGER NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
      seq           INTEGER NOT NULL,
      stream        TEXT NOT NULL CHECK (stream IN ('stdout','stderr','system')),
      line          TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_logs_deployment ON logs(deployment_id, seq);

    CREATE TABLE IF NOT EXISTS sessions (
      sid        TEXT PRIMARY KEY,
      sess       TEXT NOT NULL,
      expired_at INTEGER NOT NULL
    );
  `);
}

migrate();

module.exports = { db, migrate, dbPath };
