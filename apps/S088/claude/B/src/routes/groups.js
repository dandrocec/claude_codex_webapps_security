'use strict';

const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../middleware');
const { cleanName, toId, flash } = require('../security');

const router = express.Router();

const insertGroup = db.prepare('INSERT INTO groups (name, owner_id) VALUES (?, ?)');
const getGroup = db.prepare('SELECT * FROM groups WHERE id = ?');
const listMyGroups = db.prepare(
  `SELECT g.*, (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id) AS member_count
     FROM groups g WHERE g.owner_id = ? ORDER BY g.name COLLATE NOCASE`
);
const listMembers = db.prepare(
  `SELECT u.id, u.username FROM group_members gm
     JOIN users u ON u.id = gm.user_id
    WHERE gm.group_id = ? ORDER BY u.username COLLATE NOCASE`
);
const findUserByUsername = db.prepare('SELECT id, username FROM users WHERE username = ?');
const addMember = db.prepare(
  'INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)'
);
const removeMember = db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?');

// Only the owner may manage a group.
function ownGroupOr404(req, res) {
  const groupId = toId(req.params.id);
  const group = groupId && getGroup.get(groupId);
  if (!group || group.owner_id !== req.user.id) {
    res.status(404).render('error', { status: 404, message: 'Group not found.' });
    return null;
  }
  return group;
}

router.get('/groups', requireAuth, (req, res) => {
  res.render('groups', { groups: listMyGroups.all(req.user.id) });
});

router.post('/groups', requireAuth, (req, res) => {
  const name = cleanName(req.body.name);
  if (!name) {
    flash(req, 'error', 'Group name is required (1-120 characters).');
    return res.redirect('/groups');
  }
  insertGroup.run(name, req.user.id);
  flash(req, 'success', 'Group created.');
  res.redirect('/groups');
});

router.get('/groups/:id', requireAuth, (req, res) => {
  const group = ownGroupOr404(req, res);
  if (!group) return;
  res.render('group', { group, members: listMembers.all(group.id) });
});

router.post('/groups/:id/members', requireAuth, (req, res) => {
  const group = ownGroupOr404(req, res);
  if (!group) return;
  const username = (req.body.username || '').trim();
  const target = findUserByUsername.get(username);
  if (!target) {
    flash(req, 'error', 'No such user.');
    return res.redirect(`/groups/${group.id}`);
  }
  addMember.run(group.id, target.id);
  flash(req, 'success', `Added ${target.username} to the group.`);
  res.redirect(`/groups/${group.id}`);
});

router.post('/groups/:id/members/:uid/delete', requireAuth, (req, res) => {
  const group = ownGroupOr404(req, res);
  if (!group) return;
  const uid = toId(req.params.uid);
  if (uid) removeMember.run(group.id, uid);
  flash(req, 'success', 'Member removed.');
  res.redirect(`/groups/${group.id}`);
});

module.exports = router;
