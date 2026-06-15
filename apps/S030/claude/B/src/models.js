'use strict';

// Data-access layer. EVERY query uses parameter binding (?, :name) so that
// user-supplied values can never be interpreted as SQL (prevents SQL injection).

const db = require('./db');

// ---- Users ----------------------------------------------------------------

const insertUserStmt = db.prepare(
  'INSERT INTO users (username, password_hash) VALUES (?, ?)'
);
const findUserByNameStmt = db.prepare(
  'SELECT * FROM users WHERE username = ?'
);
const findUserByIdStmt = db.prepare(
  'SELECT id, username, created_at FROM users WHERE id = ?'
);

function createUser(username, passwordHash) {
  const info = insertUserStmt.run(username, passwordHash);
  return info.lastInsertRowid;
}

function findUserByUsername(username) {
  return findUserByNameStmt.get(username);
}

function findUserById(id) {
  return findUserByIdStmt.get(id);
}

// ---- Bookmarks ------------------------------------------------------------

const insertBookmarkStmt = db.prepare(
  `INSERT INTO bookmarks (user_id, title, url, tags)
   VALUES (@user_id, @title, @url, @tags)`
);

const listByUserStmt = db.prepare(
  `SELECT * FROM bookmarks WHERE user_id = ? ORDER BY created_at DESC`
);

const getOwnedStmt = db.prepare(
  `SELECT * FROM bookmarks WHERE id = ? AND user_id = ?`
);

const updateOwnedStmt = db.prepare(
  `UPDATE bookmarks
     SET title = @title, url = @url, tags = @tags, updated_at = datetime('now')
   WHERE id = @id AND user_id = @user_id`
);

const deleteOwnedStmt = db.prepare(
  `DELETE FROM bookmarks WHERE id = ? AND user_id = ?`
);

function createBookmark({ userId, title, url, tags }) {
  const info = insertBookmarkStmt.run({
    user_id: userId,
    title,
    url,
    tags,
  });
  return info.lastInsertRowid;
}

// Always scoped to the owning user => prevents IDOR.
function listBookmarks(userId) {
  return listByUserStmt.all(userId);
}

function getOwnedBookmark(id, userId) {
  return getOwnedStmt.get(id, userId);
}

function updateOwnedBookmark({ id, userId, title, url, tags }) {
  const info = updateOwnedStmt.run({
    id,
    user_id: userId,
    title,
    url,
    tags,
  });
  return info.changes > 0; // false when the row is not owned / not found
}

function deleteOwnedBookmark(id, userId) {
  const info = deleteOwnedStmt.run(id, userId);
  return info.changes > 0;
}

module.exports = {
  createUser,
  findUserByUsername,
  findUserById,
  createBookmark,
  listBookmarks,
  getOwnedBookmark,
  updateOwnedBookmark,
  deleteOwnedBookmark,
};
