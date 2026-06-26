const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dataDir = path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'app.sqlite');

fs.mkdirSync(dataDir, { recursive: true });

const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      username TEXT,
      display_name TEXT,
      profile_url TEXT,
      avatar_url TEXT,
      access_token TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(provider, provider_id)
    )
  `);
});

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
        return;
      }

      resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(row);
    });
  });
}

async function upsertProfile({ provider, providerId, username, displayName, profileUrl, avatarUrl, accessToken }) {
  await run(
    `
      INSERT INTO profiles (
        provider,
        provider_id,
        username,
        display_name,
        profile_url,
        avatar_url,
        access_token,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(provider, provider_id)
      DO UPDATE SET
        username = excluded.username,
        display_name = excluded.display_name,
        profile_url = excluded.profile_url,
        avatar_url = excluded.avatar_url,
        access_token = excluded.access_token,
        updated_at = CURRENT_TIMESTAMP
    `,
    [provider, providerId, username, displayName, profileUrl, avatarUrl, accessToken]
  );

  return get('SELECT * FROM profiles WHERE provider = ? AND provider_id = ?', [provider, providerId]);
}

function findProfileById(id) {
  return get('SELECT * FROM profiles WHERE id = ?', [id]);
}

module.exports = {
  db,
  dbPath,
  findProfileById,
  upsertProfile
};
