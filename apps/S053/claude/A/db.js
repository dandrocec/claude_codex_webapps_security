'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(path.join(DATA_DIR, 'portfolio.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    username  TEXT NOT NULL UNIQUE,
    password  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS projects (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    link        TEXT NOT NULL DEFAULT '',
    image       TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Seed a default owner account on first run so the app is immediately usable.
function ensureOwner() {
  const adminUser = process.env.ADMIN_USER || 'admin';
  const adminPass = process.env.ADMIN_PASS || 'changeme';

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(adminUser);
  if (!existing) {
    const hash = bcrypt.hashSync(adminPass, 10);
    db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(adminUser, hash);
    console.log(`[db] Created owner account "${adminUser}" (password: "${adminPass}").`);
    console.log('[db] Change these via ADMIN_USER / ADMIN_PASS env vars (see README).');
  }
}
ensureOwner();

module.exports = {
  db,

  findUserByUsername(username) {
    return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  },

  verifyPassword(user, plain) {
    return user ? bcrypt.compareSync(plain, user.password) : false;
  },

  listProjects() {
    return db.prepare('SELECT * FROM projects ORDER BY created_at DESC, id DESC').all();
  },

  getProject(id) {
    return db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  },

  createProject({ title, description, link, image }) {
    return db
      .prepare('INSERT INTO projects (title, description, link, image) VALUES (?, ?, ?, ?)')
      .run(title, description, link, image);
  },

  updateProject(id, { title, description, link, image }) {
    return db
      .prepare('UPDATE projects SET title = ?, description = ?, link = ?, image = ? WHERE id = ?')
      .run(title, description, link, image, id);
  },

  deleteProject(id) {
    return db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  },
};
