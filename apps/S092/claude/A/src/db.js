'use strict';

// Uses Node's built-in SQLite (Node >= 22.5). No native modules to compile.
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');

const DB_PATH = process.env.CLINIC_DB || path.join(__dirname, '..', 'clinic.db');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL CHECK (role IN ('patient','doctor','receptionist')),
      full_name     TEXT NOT NULL,
      specialty     TEXT
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id  INTEGER NOT NULL REFERENCES users(id),
      doctor_id   INTEGER NOT NULL REFERENCES users(id),
      slot        TEXT NOT NULL,                 -- ISO datetime, e.g. 2026-06-25T09:30
      reason      TEXT NOT NULL DEFAULT '',
      status      TEXT NOT NULL DEFAULT 'requested'
                    CHECK (status IN ('requested','confirmed','cancelled','completed')),
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS medical_records (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id  INTEGER NOT NULL REFERENCES users(id),
      doctor_id   INTEGER NOT NULL REFERENCES users(id),
      diagnosis   TEXT NOT NULL DEFAULT '',
      treatment   TEXT NOT NULL DEFAULT '',
      notes       TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

module.exports = { db, init, DB_PATH };
