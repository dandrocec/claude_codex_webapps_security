'use strict';

const db = require('./db');

/**
 * Resolve a user's effective role on a document.
 * Returns 'owner', 'edit', 'view', or null (no access).
 */
function getRole(documentId, userId) {
  const doc = db.prepare('SELECT owner_id FROM documents WHERE id = ?').get(documentId);
  if (!doc) return null;
  if (doc.owner_id === userId) return 'owner';

  const perm = db
    .prepare('SELECT role FROM permissions WHERE document_id = ? AND user_id = ?')
    .get(documentId, userId);
  return perm ? perm.role : null;
}

const canView = (role) => role === 'owner' || role === 'edit' || role === 'view';
const canEdit = (role) => role === 'owner' || role === 'edit';

/**
 * Full access list for a document: the owner plus every invited collaborator.
 */
function accessList(documentId) {
  const doc = db
    .prepare(
      `SELECT d.owner_id, u.username AS owner_username
         FROM documents d JOIN users u ON u.id = d.owner_id
        WHERE d.id = ?`
    )
    .get(documentId);
  if (!doc) return [];

  const collaborators = db
    .prepare(
      `SELECT u.id AS user_id, u.username, p.role
         FROM permissions p JOIN users u ON u.id = p.user_id
        WHERE p.document_id = ?
        ORDER BY u.username`
    )
    .all(documentId);

  return [
    { user_id: doc.owner_id, username: doc.owner_username, role: 'owner' },
    ...collaborators,
  ];
}

module.exports = { getRole, canView, canEdit, accessList };
