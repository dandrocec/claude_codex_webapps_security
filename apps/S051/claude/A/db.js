const path = require('path');
const Database = require('better-sqlite3');

const db = new Database(path.join(__dirname, 'watchlist.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS movies (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    title      TEXT NOT NULL,
    year       INTEGER,
    status     TEXT NOT NULL DEFAULT 'to_watch',
    rating     INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_movies_user ON movies(user_id);
`);

module.exports = db;
