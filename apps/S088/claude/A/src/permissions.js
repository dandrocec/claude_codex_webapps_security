'use strict';

const { db } = require('./db');

// Permission ranking: a higher number wins when several shares apply.
const RANK = { none: 0, view: 1, edit: 2 };

function strongest(a, b) {
  return RANK[a] >= RANK[b] ? a : b;
}

/** All group ids the user belongs to. */
function userGroupIds(userId) {
  return db
    .prepare('SELECT group_id FROM group_members WHERE user_id = ?')
    .all(userId)
    .map((r) => r.group_id);
}

/**
 * Best permission a principal (the user + their groups) has been granted on a
 * single resource, ignoring inheritance. Returns 'none' | 'view' | 'edit'.
 */
function directPermission(userId, resourceType, resourceId) {
  const groupIds = userGroupIds(userId);
  const rows = db
    .prepare(
      `SELECT principal_type, principal_id, permission
         FROM shares
        WHERE resource_type = ? AND resource_id = ?`
    )
    .all(resourceType, resourceId);

  let best = 'none';
  for (const row of rows) {
    if (row.principal_type === 'user' && row.principal_id === userId) {
      best = strongest(best, row.permission);
    } else if (row.principal_type === 'group' && groupIds.includes(row.principal_id)) {
      best = strongest(best, row.permission);
    }
  }
  return best;
}

/**
 * Effective permission for a user on a document, combining:
 *  - ownership of the document        -> edit (owner)
 *  - direct document shares
 *  - shares on the containing folder chain (folder shares cascade down)
 *  - ownership of an ancestor folder   -> edit
 * Returns 'none' | 'view' | 'edit'.
 */
function documentPermission(userId, documentId) {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(documentId);
  if (!doc) return 'none';
  if (doc.owner_id === userId) return 'edit';

  let best = directPermission(userId, 'document', documentId);
  if (best === 'edit') return best;

  // Walk up the folder chain.
  let folderId = doc.folder_id;
  const seen = new Set();
  while (folderId && !seen.has(folderId)) {
    seen.add(folderId);
    const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(folderId);
    if (!folder) break;
    if (folder.owner_id === userId) return 'edit';
    best = strongest(best, directPermission(userId, 'folder', folderId));
    if (best === 'edit') return best;
    folderId = folder.parent_id;
  }
  return best;
}

/** Effective permission for a user on a folder (ownership or share chain). */
function folderPermission(userId, folderId) {
  let best = 'none';
  let current = folderId;
  const seen = new Set();
  while (current && !seen.has(current)) {
    seen.add(current);
    const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(current);
    if (!folder) break;
    if (folder.owner_id === userId) return 'edit';
    best = strongest(best, directPermission(userId, 'folder', current));
    if (best === 'edit') return best;
    current = folder.parent_id;
  }
  return best;
}

const can = {
  viewDocument: (u, d) => RANK[documentPermission(u, d)] >= RANK.view,
  editDocument: (u, d) => RANK[documentPermission(u, d)] >= RANK.edit,
  viewFolder: (u, f) => RANK[folderPermission(u, f)] >= RANK.view,
  editFolder: (u, f) => RANK[folderPermission(u, f)] >= RANK.edit,
};

module.exports = { documentPermission, folderPermission, directPermission, can, RANK };
