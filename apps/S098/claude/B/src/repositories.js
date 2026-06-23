'use strict';

const db = require('./db');

/*
 * Every statement below is a parameterised prepared statement. User-supplied
 * values are always passed as bound parameters (?), never interpolated into
 * SQL text — this is the primary defence against SQL injection.
 */

// ---- Users ---------------------------------------------------------------

const insertUserStmt = db.prepare(
  'INSERT INTO users (username, password_hash) VALUES (?, ?)'
);
const getUserByUsernameStmt = db.prepare(
  'SELECT id, username, password_hash, created_at FROM users WHERE username = ?'
);
const getUserByIdStmt = db.prepare(
  'SELECT id, username, created_at FROM users WHERE id = ?'
);

const users = {
  create(username, passwordHash) {
    const info = insertUserStmt.run(username, passwordHash);
    return info.lastInsertRowid;
  },
  findByUsername(username) {
    return getUserByUsernameStmt.get(username);
  },
  findById(id) {
    return getUserByIdStmt.get(id);
  },
};

// ---- Documents -----------------------------------------------------------

const insertDocStmt = db.prepare(
  'INSERT INTO documents (title, content, owner_id) VALUES (?, ?, ?)'
);
const getDocStmt = db.prepare('SELECT * FROM documents WHERE id = ?');
const updateDocContentStmt = db.prepare(
  "UPDATE documents SET content = ?, updated_at = datetime('now') WHERE id = ?"
);
const updateDocTitleStmt = db.prepare(
  "UPDATE documents SET title = ?, updated_at = datetime('now') WHERE id = ?"
);
const deleteDocStmt = db.prepare('DELETE FROM documents WHERE id = ?');

// Documents the user owns OR has been granted access to.
const listDocsForUserStmt = db.prepare(`
  SELECT d.id, d.title, d.owner_id, d.updated_at,
         u.username AS owner_username,
         CASE WHEN d.owner_id = @userId THEN 'owner' ELSE a.permission END AS permission
  FROM documents d
  JOIN users u ON u.id = d.owner_id
  LEFT JOIN document_access a
         ON a.document_id = d.id AND a.user_id = @userId
  WHERE d.owner_id = @userId OR a.user_id = @userId
  ORDER BY d.updated_at DESC
`);

const documents = {
  create(title, content, ownerId) {
    const info = insertDocStmt.run(title, content, ownerId);
    return info.lastInsertRowid;
  },
  findById(id) {
    return getDocStmt.get(id);
  },
  updateContent(id, content) {
    updateDocContentStmt.run(content, id);
  },
  updateTitle(id, title) {
    updateDocTitleStmt.run(title, id);
  },
  remove(id) {
    deleteDocStmt.run(id);
  },
  listForUser(userId) {
    return listDocsForUserStmt.all({ userId });
  },
};

// ---- Document access (collaborators) -------------------------------------

const upsertAccessStmt = db.prepare(`
  INSERT INTO document_access (document_id, user_id, permission)
  VALUES (?, ?, ?)
  ON CONFLICT(document_id, user_id) DO UPDATE SET permission = excluded.permission
`);
const getAccessStmt = db.prepare(
  'SELECT permission FROM document_access WHERE document_id = ? AND user_id = ?'
);
const removeAccessStmt = db.prepare(
  'DELETE FROM document_access WHERE document_id = ? AND user_id = ?'
);
const listCollaboratorsStmt = db.prepare(`
  SELECT u.id AS user_id, u.username, a.permission, a.created_at
  FROM document_access a
  JOIN users u ON u.id = a.user_id
  WHERE a.document_id = ?
  ORDER BY u.username COLLATE NOCASE ASC
`);

const access = {
  grant(documentId, userId, permission) {
    upsertAccessStmt.run(documentId, userId, permission);
  },
  get(documentId, userId) {
    const row = getAccessStmt.get(documentId, userId);
    return row ? row.permission : null;
  },
  revoke(documentId, userId) {
    removeAccessStmt.run(documentId, userId);
  },
  listForDocument(documentId) {
    return listCollaboratorsStmt.all(documentId);
  },
};

/**
 * Resolve the effective permission a user has on a document.
 * Returns 'owner' | 'edit' | 'view' | null. This single function is the
 * authority for all access-control decisions (prevents IDOR).
 */
function effectivePermission(documentId, userId) {
  const doc = documents.findById(documentId);
  if (!doc) return { doc: null, permission: null };
  if (doc.owner_id === userId) return { doc, permission: 'owner' };
  return { doc, permission: access.get(documentId, userId) };
}

module.exports = { users, documents, access, effectivePermission };
