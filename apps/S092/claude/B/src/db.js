'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'clinic.db');

// Ensure the directory for the database file exists.
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// Pragmas for integrity and sane concurrency.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Schema. All access elsewhere uses prepared/parameterised statements.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,
    email         TEXT    NOT NULL UNIQUE,
    full_name     TEXT    NOT NULL,
    role          TEXT    NOT NULL CHECK (role IN ('patient','doctor','receptionist')),
    password_hash TEXT    NOT NULL,
    -- For patients: the doctor assigned to them. NULL for staff.
    doctor_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS appointments (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    doctor_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scheduled_at TEXT    NOT NULL,
    reason       TEXT    NOT NULL,
    status       TEXT    NOT NULL DEFAULT 'requested'
                 CHECK (status IN ('requested','confirmed','cancelled','completed')),
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS records (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    doctor_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT    NOT NULL,
    notes       TEXT    NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_appt_patient ON appointments(patient_id);
  CREATE INDEX IF NOT EXISTS idx_appt_doctor  ON appointments(doctor_id);
  CREATE INDEX IF NOT EXISTS idx_rec_patient  ON records(patient_id);
`);

module.exports = db;
