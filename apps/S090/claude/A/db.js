'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// Keep all database files together in a ./data directory.
const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'app.sqlite'));
db.pragma('journal_mode = WAL');

// One row per user. We store the basic profile returned by the provider plus
// the OAuth access token so the app can call the provider's API on the user's
// behalf later (e.g. to fetch live account data).
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    provider      TEXT NOT NULL,
    provider_id   TEXT NOT NULL,
    username      TEXT,
    display_name  TEXT,
    avatar_url    TEXT,
    profile_url   TEXT,
    access_token  TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (provider, provider_id)
  );
`);

const insertStmt = db.prepare(`
  INSERT INTO users (provider, provider_id, username, display_name, avatar_url, profile_url, access_token)
  VALUES (@provider, @provider_id, @username, @display_name, @avatar_url, @profile_url, @access_token)
  ON CONFLICT (provider, provider_id) DO UPDATE SET
    username     = excluded.username,
    display_name = excluded.display_name,
    avatar_url   = excluded.avatar_url,
    profile_url  = excluded.profile_url,
    access_token = excluded.access_token,
    updated_at   = datetime('now')
`);

const selectByIdStmt = db.prepare('SELECT * FROM users WHERE id = ?');
const selectByProviderStmt = db.prepare(
  'SELECT * FROM users WHERE provider = ? AND provider_id = ?'
);

/**
 * Insert or update a user from an OAuth profile, returning the stored row.
 */
function upsertUser(user) {
  insertStmt.run(user);
  return selectByProviderStmt.get(user.provider, user.provider_id);
}

function getUserById(id) {
  return selectByIdStmt.get(id);
}

module.exports = { db, upsertUser, getUserById };
