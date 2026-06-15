'use strict';

// All queries use prepared statements with bound parameters (no string
// concatenation of user input) to prevent SQL injection.

const db = require('./db');

const Users = {
  findByUsername(username) {
    return db
      .prepare('SELECT id, username, password_hash FROM users WHERE username = ?')
      .get(username);
  },

  findById(id) {
    return db.prepare('SELECT id, username FROM users WHERE id = ?').get(id);
  },

  create(username, passwordHash) {
    const info = db
      .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
      .run(username, passwordHash);
    return info.lastInsertRowid;
  },

  count() {
    return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  },
};

const Projects = {
  // Public listing — every visitor sees the full grid.
  all() {
    return db
      .prepare(
        `SELECT id, owner_id, title, description, link, image_url, created_at
           FROM projects
          ORDER BY created_at DESC, id DESC`
      )
      .all();
  },

  // Projects belonging to a single owner (admin dashboard).
  byOwner(ownerId) {
    return db
      .prepare(
        `SELECT id, owner_id, title, description, link, image_url, created_at
           FROM projects
          WHERE owner_id = ?
          ORDER BY created_at DESC, id DESC`
      )
      .all(ownerId);
  },

  findById(id) {
    return db
      .prepare(
        `SELECT id, owner_id, title, description, link, image_url
           FROM projects
          WHERE id = ?`
      )
      .get(id);
  },

  create(ownerId, { title, description, link, imageUrl }) {
    const info = db
      .prepare(
        `INSERT INTO projects (owner_id, title, description, link, image_url)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(ownerId, title, description, link, imageUrl);
    return info.lastInsertRowid;
  },

  // Update is scoped to the owner_id as a defence-in-depth measure against
  // IDOR: even if an authorization check were missed, the WHERE clause
  // guarantees a user can only modify their own rows.
  update(id, ownerId, { title, description, link, imageUrl }) {
    const info = db
      .prepare(
        `UPDATE projects
            SET title = ?, description = ?, link = ?, image_url = ?,
                updated_at = datetime('now')
          WHERE id = ? AND owner_id = ?`
      )
      .run(title, description, link, imageUrl, id, ownerId);
    return info.changes; // 0 means not found or not owned.
  },

  delete(id, ownerId) {
    const info = db
      .prepare('DELETE FROM projects WHERE id = ? AND owner_id = ?')
      .run(id, ownerId);
    return info.changes;
  },
};

module.exports = { Users, Projects };
