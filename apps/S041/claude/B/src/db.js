'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const config = require('./config');

// Ensure the directory holding the SQLite file exists.
fs.mkdirSync(path.dirname(config.databaseFile), { recursive: true });

const db = new Database(config.databaseFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS faqs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    question    TEXT    NOT NULL,
    answer      TEXT    NOT NULL,
    category    TEXT    NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    author_id   INTEGER NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_faqs_category ON faqs(category);
  CREATE INDEX IF NOT EXISTS idx_faqs_author   ON faqs(author_id);
`);

// ---- Seed the initial editor account on first run -------------------------
function seedAdminUser() {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM users').get();
  if (count > 0) return;

  let password = config.seedAdminPassword;
  let generated = false;
  if (!password) {
    // Generate a strong random password and surface it once so the operator
    // can log in. We never hardcode a default credential.
    password = crypto.randomBytes(12).toString('base64url');
    generated = true;
  }

  const hash = bcrypt.hashSync(password, 12);
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(
    config.seedAdminUsername,
    hash
  );

  // eslint-disable-next-line no-console
  console.log(
    `Seeded editor account "${config.seedAdminUsername}".` +
      (generated
        ? ` Generated password (shown once): ${password}`
        : ' Password taken from SEED_ADMIN_PASSWORD.')
  );
}

seedAdminUser();

module.exports = db;
