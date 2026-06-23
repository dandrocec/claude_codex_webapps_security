'use strict';

// Uses Node's built-in SQLite (stable & unflagged since Node 22.13 / 23.4+).
// No native modules to compile — works out of the box on Node >= 22.5.
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'crm.db');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');

// Pipeline stages, in order. "won" / "lost" are terminal columns on the board.
const STAGES = ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT    NOT NULL,
      email         TEXT    NOT NULL UNIQUE,
      password_hash TEXT    NOT NULL,
      role          TEXT    NOT NULL DEFAULT 'sales' CHECK (role IN ('sales','manager'))
    );

    CREATE TABLE IF NOT EXISTS contacts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      email      TEXT,
      phone      TEXT,
      company    TEXT,
      owner_id   INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS deals (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      title      TEXT    NOT NULL,
      value      REAL    NOT NULL DEFAULT 0,
      stage      TEXT    NOT NULL DEFAULT 'lead',
      contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
      owner_id   INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_contacts_owner ON contacts(owner_id);
    CREATE INDEX IF NOT EXISTS idx_deals_owner    ON deals(owner_id);
    CREATE INDEX IF NOT EXISTS idx_deals_stage    ON deals(stage);
  `);
}

module.exports = { db, init, STAGES };
