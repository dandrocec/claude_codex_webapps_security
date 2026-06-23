'use strict';

const express = require('express');
const { db } = require('../db');
const { requireAuth, asyncHandler } = require('../middleware');

const router = express.Router();
router.use(requireAuth);

/** Only the owner of a resource may manage its shares. */
function ownsResource(userId, type, id) {
  const table = type === 'folder' ? 'folders' : 'documents';
  const row = db.prepare(`SELECT owner_id FROM ${table} WHERE id = ?`).get(id);
  return row && row.owner_id === userId;
}

function validResource(type) {
  return type === 'folder' || type === 'document';
}

// List the shares on a resource.
router.get(
  '/:resourceType/:resourceId',
  asyncHandler((req, res) => {
    const { resourceType, resourceId } = req.params;
    if (!validResource(resourceType)) return res.status(400).json({ error: 'bad resource type' });
    if (!ownsResource(req.session.userId, resourceType, resourceId)) {
      return res.status(403).json({ error: 'only the owner can view shares' });
    }
    const rows = db
      .prepare(
        `SELECT s.id, s.principal_type, s.principal_id, s.permission,
                CASE s.principal_type
                  WHEN 'user'  THEN (SELECT username FROM users  WHERE id = s.principal_id)
                  WHEN 'group' THEN (SELECT name     FROM groups WHERE id = s.principal_id)
                END AS principal_name
           FROM shares s
          WHERE s.resource_type = ? AND s.resource_id = ?
          ORDER BY s.principal_type, principal_name`
      )
      .all(resourceType, resourceId);
    res.json(rows);
  })
);

// Create or update a share (grant view/edit to a user or group).
router.post(
  '/:resourceType/:resourceId',
  asyncHandler((req, res) => {
    const { resourceType, resourceId } = req.params;
    const { principalType, principalId, permission } = req.body || {};

    if (!validResource(resourceType)) return res.status(400).json({ error: 'bad resource type' });
    if (!['user', 'group'].includes(principalType)) {
      return res.status(400).json({ error: 'principalType must be user or group' });
    }
    if (!['view', 'edit'].includes(permission)) {
      return res.status(400).json({ error: 'permission must be view or edit' });
    }
    if (!ownsResource(req.session.userId, resourceType, resourceId)) {
      return res.status(403).json({ error: 'only the owner can share' });
    }

    const principalTable = principalType === 'user' ? 'users' : 'groups';
    const principal = db
      .prepare(`SELECT id FROM ${principalTable} WHERE id = ?`)
      .get(principalId);
    if (!principal) return res.status(404).json({ error: `${principalType} not found` });

    // Upsert: change the permission if the share already exists.
    db.prepare(
      `INSERT INTO shares (resource_type, resource_id, principal_type, principal_id, permission)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (resource_type, resource_id, principal_type, principal_id)
       DO UPDATE SET permission = excluded.permission`
    ).run(resourceType, resourceId, principalType, principalId, permission);

    res.status(201).json({ ok: true });
  })
);

// Revoke a share.
router.delete(
  '/:id',
  asyncHandler((req, res) => {
    const share = db.prepare('SELECT * FROM shares WHERE id = ?').get(req.params.id);
    if (!share) return res.status(404).json({ error: 'share not found' });
    if (!ownsResource(req.session.userId, share.resource_type, share.resource_id)) {
      return res.status(403).json({ error: 'only the owner can revoke shares' });
    }
    db.prepare('DELETE FROM shares WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  })
);

module.exports = router;
