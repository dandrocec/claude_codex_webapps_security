'use strict';

const { db } = require('./db');

// ---- Prepared (parameterised) statements ----------------------------------
const stmts = {
  getDocument: db.prepare('SELECT * FROM documents WHERE id = ?'),
  getFolder: db.prepare('SELECT * FROM folders WHERE id = ?'),
  getGroup: db.prepare('SELECT * FROM groups WHERE id = ?'),
  isGroupMember: db.prepare(
    'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?'
  ),
  userShare: db.prepare(
    `SELECT permission FROM shares
       WHERE document_id = ? AND subject_type = 'user' AND subject_id = ?`
  ),
  groupShares: db.prepare(
    `SELECT s.permission FROM shares s
       JOIN group_members gm ON gm.group_id = s.subject_id
      WHERE s.document_id = ? AND s.subject_type = 'group' AND gm.user_id = ?`
  ),
};

// Permission ranking: 'edit' implies 'view'.
const RANK = { none: 0, view: 1, edit: 2 };

/**
 * Resolve the effective permission a user has on a document.
 * Returns one of: 'owner', 'edit', 'view', or null (no access).
 *
 * This is the single chokepoint for authorisation and is what prevents IDOR:
 * every document/version/share operation routes through here using the
 * authenticated session user id — never a client-supplied owner id.
 */
function documentPermission(documentId, userId) {
  const doc = stmts.getDocument.get(documentId);
  if (!doc) return { doc: null, level: null };

  if (doc.owner_id === userId) return { doc, level: 'owner' };

  let best = 'none';

  const direct = stmts.userShare.get(documentId, userId);
  if (direct && RANK[direct.permission] > RANK[best]) best = direct.permission;

  for (const row of stmts.groupShares.all(documentId, userId)) {
    if (RANK[row.permission] > RANK[best]) best = row.permission;
  }

  return { doc, level: best === 'none' ? null : best };
}

function canView(level) {
  return level === 'owner' || level === 'edit' || level === 'view';
}

function canEdit(level) {
  return level === 'owner' || level === 'edit';
}

// Folders are private to their owner in this system. Group/user sharing applies
// at the document level.
function folderOwnedBy(folderId, userId) {
  const folder = stmts.getFolder.get(folderId);
  if (!folder || folder.owner_id !== userId) return null;
  return folder;
}

function groupVisibleTo(groupId, userId) {
  // A user can reference a group they own or belong to (e.g. when sharing).
  const group = stmts.getGroup.get(groupId);
  if (!group) return null;
  if (group.owner_id === userId) return group;
  if (stmts.isGroupMember.get(groupId, userId)) return group;
  return null;
}

module.exports = {
  documentPermission,
  canView,
  canEdit,
  folderOwnedBy,
  groupVisibleTo,
};
