'use strict';

const express = require('express');
const { db } = require('../db');
const { requireAuth, asyncHandler } = require('../middleware');
const { can, folderPermission } = require('../permissions');

const router = express.Router();
router.use(requireAuth);

// Folders the user can see: owned, or shared (directly or via a group).
router.get(
  '/',
  asyncHandler((req, res) => {
    const uid = req.session.userId;
    const owned = db
      .prepare('SELECT *, 1 AS owned FROM folders WHERE owner_id = ? ORDER BY name')
      .all(uid);

    // Folders shared with the user that they do not own.
    const sharedIds = db
      .prepare(
        `SELECT DISTINCT resource_id FROM shares
          WHERE resource_type = 'folder'
            AND ((principal_type = 'user'  AND principal_id = ?)
              OR (principal_type = 'group' AND principal_id IN
                   (SELECT group_id FROM group_members WHERE user_id = ?)))`
      )
      .all(uid, uid)
      .map((r) => r.resource_id);

    const ownedIds = new Set(owned.map((f) => f.id));
    const shared = sharedIds
      .filter((id) => !ownedIds.has(id))
      .map((id) => db.prepare('SELECT *, 0 AS owned FROM folders WHERE id = ?').get(id))
      .filter(Boolean);

    res.json([...owned, ...shared]);
  })
);

router.post(
  '/',
  asyncHandler((req, res) => {
    const { name, parentId } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });

    if (parentId) {
      const parent = db.prepare('SELECT * FROM folders WHERE id = ?').get(parentId);
      if (!parent) return res.status(404).json({ error: 'parent folder not found' });
      if (!can.editFolder(req.session.userId, parentId)) {
        return res.status(403).json({ error: 'no permission on parent folder' });
      }
    }
    const info = db
      .prepare('INSERT INTO folders (name, owner_id, parent_id) VALUES (?, ?, ?)')
      .run(name, req.session.userId, parentId || null);
    res.status(201).json({ id: info.lastInsertRowid, name, parent_id: parentId || null });
  })
);

router.delete(
  '/:id',
  asyncHandler((req, res) => {
    const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(req.params.id);
    if (!folder) return res.status(404).json({ error: 'folder not found' });
    if (folder.owner_id !== req.session.userId) {
      return res.status(403).json({ error: 'only the owner can delete a folder' });
    }
    // ON DELETE CASCADE removes sub-folders, documents and their versions.
    db.prepare('DELETE FROM folders WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  })
);

// Convenience: report the caller's effective permission on a folder.
router.get(
  '/:id/permission',
  asyncHandler((req, res) => {
    res.json({ permission: folderPermission(req.session.userId, Number(req.params.id)) });
  })
);

module.exports = router;
