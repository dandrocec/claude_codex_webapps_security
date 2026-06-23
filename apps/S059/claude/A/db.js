'use strict';

const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const db = new Database(path.join(__dirname, 'data.sqlite'));

// Improves concurrency / durability behaviour for the small web workload.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    name     TEXT NOT NULL UNIQUE,
    capacity INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id    INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date       TEXT NOT NULL,           -- YYYY-MM-DD
    slot       TEXT NOT NULL,           -- e.g. "09:00-10:00"
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    -- This is the core guard against double-booking: a given room + day + slot
    -- can exist at most once in the table.
    UNIQUE (room_id, date, slot)
  );
`);

// ---------------------------------------------------------------------------
// Seed data (rooms + a demo user) so the app is usable immediately.
// ---------------------------------------------------------------------------
const roomCount = db.prepare('SELECT COUNT(*) AS n FROM rooms').get().n;
if (roomCount === 0) {
  const insertRoom = db.prepare('INSERT INTO rooms (name, capacity) VALUES (?, ?)');
  const seedRooms = [
    ['Conference Room A', 12],
    ['Conference Room B', 8],
    ['Focus Room 1', 2],
    ['Focus Room 2', 2],
    ['Board Room', 20],
  ];
  const tx = db.transaction((rows) => rows.forEach((r) => insertRoom.run(r[0], r[1])));
  tx(seedRooms);
}

const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
if (userCount === 0) {
  const hash = bcrypt.hashSync('password123', 10);
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('demo', hash);
}

module.exports = db;
