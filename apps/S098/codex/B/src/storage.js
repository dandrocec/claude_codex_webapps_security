const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.DATABASE_FILE || path.join(dataDir, 'app.sqlite');
const database = new sqlite3.Database(dbPath);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    database.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    database.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    database.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

async function init() {
  await run('PRAGMA foreign_keys = ON');
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS document_collaborators (
      document_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('view', 'edit')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(document_id, user_id),
      FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
}

async function createUser(username, passwordHash) {
  const result = await run(
    'INSERT INTO users (username, password_hash) VALUES (?, ?)',
    [username, passwordHash]
  );
  return { id: result.id, username };
}

function findUserByUsername(username) {
  return get(
    'SELECT id, username, password_hash FROM users WHERE username = ?',
    [username]
  );
}

async function createDocument(ownerId, title) {
  const result = await run(
    'INSERT INTO documents (owner_id, title) VALUES (?, ?)',
    [ownerId, title]
  );
  return { id: result.id, owner_id: ownerId, title };
}

function listDocumentsForUser(userId) {
  return all(`
    SELECT d.id, d.title, d.updated_at,
      CASE WHEN d.owner_id = ? THEN 'owner' ELSE dc.role END AS role
    FROM documents d
    LEFT JOIN document_collaborators dc
      ON dc.document_id = d.id AND dc.user_id = ?
    WHERE d.owner_id = ? OR dc.user_id = ?
    ORDER BY d.updated_at DESC, d.id DESC
  `, [userId, userId, userId, userId]);
}

function getDocumentAccess(documentId, userId) {
  return get(`
    SELECT d.id, d.owner_id, owner.username AS owner_username, d.title, d.content, d.updated_at,
      CASE WHEN d.owner_id = ? THEN 'edit' ELSE dc.role END AS role
    FROM documents d
    JOIN users owner ON owner.id = d.owner_id
    LEFT JOIN document_collaborators dc
      ON dc.document_id = d.id AND dc.user_id = ?
    WHERE d.id = ? AND (d.owner_id = ? OR dc.user_id = ?)
  `, [userId, userId, documentId, userId, userId]);
}

function listCollaborators(documentId) {
  return all(`
    SELECT u.id, u.username, dc.role, dc.created_at
    FROM document_collaborators dc
    JOIN users u ON u.id = dc.user_id
    WHERE dc.document_id = ?
    ORDER BY u.username ASC
  `, [documentId]);
}

function upsertCollaborator(documentId, userId, role) {
  return run(`
    INSERT INTO document_collaborators (document_id, user_id, role)
    VALUES (?, ?, ?)
    ON CONFLICT(document_id, user_id) DO UPDATE SET role = excluded.role
  `, [documentId, userId, role]);
}

function removeCollaborator(documentId, userId) {
  return run(
    'DELETE FROM document_collaborators WHERE document_id = ? AND user_id = ?',
    [documentId, userId]
  );
}

async function updateDocumentContent(documentId, userId, content) {
  await run(`
    UPDATE documents
    SET content = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND (
      owner_id = ? OR EXISTS (
        SELECT 1 FROM document_collaborators
        WHERE document_id = documents.id AND user_id = ? AND role = 'edit'
      )
    )
  `, [content, documentId, userId, userId]);

  return get(
    'SELECT content, updated_at FROM documents WHERE id = ?',
    [documentId]
  );
}

module.exports = {
  init,
  createUser,
  findUserByUsername,
  createDocument,
  listDocumentsForUser,
  getDocumentAccess,
  listCollaborators,
  upsertCollaborator,
  removeCollaborator,
  updateDocumentContent
};
