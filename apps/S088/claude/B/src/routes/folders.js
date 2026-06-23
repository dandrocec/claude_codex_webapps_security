'use strict';

const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../middleware');
const { folderOwnedBy } = require('../access');
const { cleanName, toId, flash } = require('../security');

const router = express.Router();

const listFolders = db.prepare(
  'SELECT * FROM folders WHERE owner_id = ? ORDER BY name COLLATE NOCASE'
);
const insertFolder = db.prepare('INSERT INTO folders (name, owner_id) VALUES (?, ?)');
const listDocsInFolder = db.prepare(
  `SELECT d.id, d.name, d.created_at,
          v.version_number, v.mime_type, v.size, v.created_at AS updated_at
     FROM documents d
     LEFT JOIN document_versions v ON v.id = d.current_version_id
    WHERE d.folder_id = ?
    ORDER BY d.name COLLATE NOCASE`
);

// Documents shared with the current user (directly or via a group).
const listSharedWithMe = db.prepare(
  `SELECT DISTINCT d.id, d.name, u.username AS owner_name,
          MAX(CASE WHEN s.permission = 'edit' THEN 2 ELSE 1 END) AS perm_rank
     FROM shares s
     JOIN documents d ON d.id = s.document_id
     JOIN users u ON u.id = d.owner_id
     LEFT JOIN group_members gm
            ON s.subject_type = 'group' AND gm.group_id = s.subject_id AND gm.user_id = ?
    WHERE (s.subject_type = 'user' AND s.subject_id = ?)
       OR (s.subject_type = 'group' AND gm.user_id IS NOT NULL)
    GROUP BY d.id
    ORDER BY d.name COLLATE NOCASE`
);

// Dashboard: the user's folders + documents shared with them.
router.get('/', requireAuth, (req, res) => {
  const folders = listFolders.all(req.user.id);
  const shared = listSharedWithMe.all(req.user.id, req.user.id).map((r) => ({
    ...r,
    permission: r.perm_rank === 2 ? 'edit' : 'view',
  }));
  res.render('dashboard', { folders, shared });
});

router.post('/folders', requireAuth, (req, res) => {
  const name = cleanName(req.body.name);
  if (!name) {
    flash(req, 'error', 'Folder name is required (1-120 characters).');
    return res.redirect('/');
  }
  insertFolder.run(name, req.user.id);
  flash(req, 'success', 'Folder created.');
  res.redirect('/');
});

router.get('/folders/:id', requireAuth, (req, res) => {
  const folderId = toId(req.params.id);
  // Ownership check prevents IDOR on folders.
  const folder = folderId && folderOwnedBy(folderId, req.user.id);
  if (!folder) {
    return res.status(404).render('error', { status: 404, message: 'Folder not found.' });
  }
  const documents = listDocsInFolder.all(folderId);
  res.render('folder', { folder, documents });
});

module.exports = router;
