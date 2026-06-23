'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

/**
 * Database access layer.
 *
 * SQL injection is prevented everywhere by using better-sqlite3 prepared
 * statements with bound parameters (the `?` placeholders) — user-controlled
 * values are NEVER concatenated into SQL strings.
 */

fs.mkdirSync(config.dataDir, { recursive: true });

// Two databases keep concerns separate; both live under data/.
const appDb = new Database(path.join(config.dataDir, 'app.db'));
const sessionDb = new Database(path.join(config.dataDir, 'sessions.db'));

appDb.pragma('journal_mode = WAL');
appDb.pragma('foreign_keys = ON');

appDb.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    provider        TEXT NOT NULL,
    provider_id     TEXT NOT NULL,
    username        TEXT NOT NULL,
    display_name    TEXT,
    avatar_url      TEXT,
    profile_url     TEXT,
    email           TEXT,
    access_token    TEXT,            -- AES-256-GCM encrypted, never plaintext
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(provider, provider_id)
  );
`);

const statements = {
  findById: appDb.prepare('SELECT * FROM users WHERE id = ?'),
  findByProvider: appDb.prepare(
    'SELECT * FROM users WHERE provider = ? AND provider_id = ?'
  ),
  insert: appDb.prepare(`
    INSERT INTO users
      (provider, provider_id, username, display_name, avatar_url, profile_url, email, access_token)
    VALUES
      (@provider, @provider_id, @username, @display_name, @avatar_url, @profile_url, @email, @access_token)
  `),
  update: appDb.prepare(`
    UPDATE users SET
      username     = @username,
      display_name = @display_name,
      avatar_url   = @avatar_url,
      profile_url  = @profile_url,
      email        = @email,
      access_token = @access_token,
      updated_at   = datetime('now')
    WHERE id = @id
  `),
};

/**
 * Insert-or-update a user keyed on (provider, provider_id). Returns the row.
 */
function upsertUser(profile) {
  const existing = statements.findByProvider.get(profile.provider, profile.provider_id);
  if (existing) {
    statements.update.run({ ...profile, id: existing.id });
    return statements.findById.get(existing.id);
  }
  const info = statements.insert.run(profile);
  return statements.findById.get(info.lastInsertRowid);
}

function findUserById(id) {
  return statements.findById.get(id);
}

module.exports = {
  appDb,
  sessionDb,
  upsertUser,
  findUserById,
};
