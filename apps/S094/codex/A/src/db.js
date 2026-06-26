const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");

const dataDir = path.join(__dirname, "..", "data");
const dbPath = path.join(dataDir, "hub.sqlite");

let dbPromise;

async function getDb() {
  if (!dbPromise) {
    fs.mkdirSync(dataDir, { recursive: true });
    dbPromise = open({
      filename: dbPath,
      driver: sqlite3.Database
    }).then(async (db) => {
      await db.exec("PRAGMA foreign_keys = ON");
      await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS webhooks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          token TEXT NOT NULL UNIQUE,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS actions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          webhook_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          target_url TEXT NOT NULL,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (webhook_id) REFERENCES webhooks(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          webhook_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          method TEXT NOT NULL,
          headers_json TEXT NOT NULL,
          body_json TEXT NOT NULL,
          source_ip TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (webhook_id) REFERENCES webhooks(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS deliveries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_id INTEGER NOT NULL,
          action_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          attempt INTEGER NOT NULL DEFAULT 1,
          status TEXT NOT NULL,
          status_code INTEGER,
          response_body TEXT,
          error TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          completed_at TEXT,
          FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
          FOREIGN KEY (action_id) REFERENCES actions(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
      `);
      return db;
    });
  }
  return dbPromise;
}

module.exports = { getDb };
