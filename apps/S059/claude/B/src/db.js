'use strict';

const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');

// node:sqlite is built into Node (>= 22.5, flag-free since the v23.4 line that
// Node 24 is built on). Fail fast with actionable guidance if unavailable.
let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (err) {
  // eslint-disable-next-line no-console
  console.error(
    'FATAL: the built-in "node:sqlite" module is unavailable.\n' +
      `You are running Node ${process.version}. This app requires Node >= 22.5 ` +
      '(Node 24 recommended).\n' +
      'If you are on Node 22.x, start with: node --experimental-sqlite src/server.js',
  );
  throw err;
}

const config = require('./config');

// Ensure the directory for the database file exists.
const dbPath = path.resolve(config.databaseFile);
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);

// Pragmas: enforce foreign keys and use WAL for better concurrency.
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

// --- Schema -----------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL UNIQUE,
    description TEXT    NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    room_id    INTEGER NOT NULL,
    date       TEXT    NOT NULL,           -- ISO date 'YYYY-MM-DD'
    slot       TEXT    NOT NULL,           -- e.g. '09:00-10:00'
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    -- The heart of double-booking prevention: a room+date+slot can exist once.
    UNIQUE (room_id, date, slot)
  );

  CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id);
  CREATE INDEX IF NOT EXISTS idx_bookings_lookup ON bookings(date, room_id);
`);

// --- Seed rooms (idempotent) ------------------------------------------------
const roomCount = db.prepare('SELECT COUNT(*) AS c FROM rooms').get().c;
if (roomCount === 0) {
  const insertRoom = db.prepare('INSERT INTO rooms (name, description) VALUES (?, ?)');
  insertRoom.run('Aspen', 'Small meeting room (up to 4 people)');
  insertRoom.run('Birch', 'Medium meeting room (up to 8 people)');
  insertRoom.run('Cedar', 'Large conference room (up to 20 people)');
  insertRoom.run('Dogwood', 'Quiet focus room (1-2 people)');
}

// --- Seed a demo user in development so the app is usable immediately --------
if (!config.isProduction) {
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get('demo');
  if (!existing) {
    const hash = bcrypt.hashSync('Password123!', 12);
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('demo', hash);
    // eslint-disable-next-line no-console
    console.log('Seeded demo user — username: "demo", password: "Password123!"');
  }
}

module.exports = db;
