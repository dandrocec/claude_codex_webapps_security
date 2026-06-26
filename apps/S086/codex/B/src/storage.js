const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");
const Database = require("better-sqlite3");

const databaseFile =
  process.env.DATABASE_FILE || path.join(__dirname, "..", "data", "app.sqlite");
fs.mkdirSync(path.dirname(databaseFile), { recursive: true });

const db = new Database(databaseFile);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

function initializeDatabase({ adminEmail, adminPassword }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL CHECK(length(name) BETWEEN 2 AND 80),
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TRIGGER IF NOT EXISTS users_updated_at
    AFTER UPDATE ON users
    BEGIN
      UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;
  `);

  const existingAdmin = findAdminByEmail(adminEmail);
  if (!existingAdmin) {
    const passwordHash = bcrypt.hashSync(adminPassword, 12);
    createUser({
      name: "Site Administrator",
      email: adminEmail,
      role: "admin",
      passwordHash
    });
  }
}

function findAdminByEmail(email) {
  return db
    .prepare(
      "SELECT id, name, email, password_hash, role, active FROM users WHERE email = ? AND role = 'admin'"
    )
    .get(email);
}

function findUserById(id) {
  return db
    .prepare(
      "SELECT id, name, email, password_hash, role, active, created_at, updated_at FROM users WHERE id = ?"
    )
    .get(id);
}

function listUsers() {
  return db
    .prepare(
      "SELECT id, name, email, role, active, created_at, updated_at FROM users ORDER BY created_at DESC, id DESC"
    )
    .all();
}

function createUser({ name, email, role, passwordHash }) {
  return db
    .prepare(
      "INSERT INTO users (name, email, role, password_hash) VALUES (?, ?, ?, ?)"
    )
    .run(name, email, role, passwordHash);
}

function updateUser({ id, name, email, role, passwordHash }) {
  return db
    .prepare(
      "UPDATE users SET name = ?, email = ?, role = ?, password_hash = ? WHERE id = ?"
    )
    .run(name, email, role, passwordHash, id);
}

function setUserActive(id, active) {
  return db
    .prepare("UPDATE users SET active = ? WHERE id = ?")
    .run(active ? 1 : 0, id);
}

function getStats() {
  const totalUsers = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
  const activeUsers = db
    .prepare("SELECT COUNT(*) AS count FROM users WHERE active = 1")
    .get().count;
  const admins = db
    .prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'")
    .get().count;
  const createdToday = db
    .prepare(
      "SELECT COUNT(*) AS count FROM users WHERE date(created_at) = date('now')"
    )
    .get().count;

  return { totalUsers, activeUsers, admins, createdToday };
}

module.exports = {
  db,
  initializeDatabase,
  findAdminByEmail,
  findUserById,
  listUsers,
  createUser,
  updateUser,
  setUserActive,
  getStats
};
