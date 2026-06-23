'use strict';

const express = require('express');
const { db } = require('../db');
const { requireAuth, asyncHandler } = require('../middleware');

const router = express.Router();
router.use(requireAuth);

// Groups the current user owns or belongs to.
router.get(
  '/',
  asyncHandler((req, res) => {
    const uid = req.session.userId;
    const rows = db
      .prepare(
        `SELECT g.id, g.name, g.owner_id,
                (g.owner_id = ?) AS is_owner
           FROM groups g
          WHERE g.owner_id = ?
             OR g.id IN (SELECT group_id FROM group_members WHERE user_id = ?)
          ORDER BY g.name`
      )
      .all(uid, uid, uid);
    res.json(rows);
  })
);

router.post(
  '/',
  asyncHandler((req, res) => {
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });
    try {
      const info = db
        .prepare('INSERT INTO groups (name, owner_id) VALUES (?, ?)')
        .run(name, req.session.userId);
      // The creator is implicitly a member.
      db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)').run(
        info.lastInsertRowid,
        req.session.userId
      );
      res.status(201).json({ id: info.lastInsertRowid, name });
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) {
        return res.status(409).json({ error: 'group name already exists' });
      }
      throw e;
    }
  })
);

router.get(
  '/:id/members',
  asyncHandler((req, res) => {
    const members = db
      .prepare(
        `SELECT u.id, u.username
           FROM group_members gm JOIN users u ON u.id = gm.user_id
          WHERE gm.group_id = ?
          ORDER BY u.username`
      )
      .all(req.params.id);
    res.json(members);
  })
);

// Only the group owner can change membership.
function requireGroupOwner(req, res, next) {
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ error: 'group not found' });
  if (group.owner_id !== req.session.userId) {
    return res.status(403).json({ error: 'only the group owner can manage members' });
  }
  next();
}

router.post(
  '/:id/members',
  requireGroupOwner,
  asyncHandler((req, res) => {
    const { userId } = req.body || {};
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ error: 'user not found' });
    db.prepare(
      'INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)'
    ).run(req.params.id, userId);
    res.status(201).json({ ok: true });
  })
);

router.delete(
  '/:id/members/:userId',
  requireGroupOwner,
  asyncHandler((req, res) => {
    db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(
      req.params.id,
      req.params.userId
    );
    res.json({ ok: true });
  })
);

module.exports = router;
