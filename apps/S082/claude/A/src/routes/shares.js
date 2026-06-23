'use strict';

const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth } = require('../auth');
const { storedFilePath } = require('../storage');

const router = express.Router();

// ---- Authenticated management of share links --------------------------------

router.get('/shares', requireAuth, (req, res) => {
  const shares = db
    .prepare(
      `SELECT s.*, f.original_name
       FROM shares s
       JOIN files f ON f.id = s.file_id
       WHERE s.user_id = ?
       ORDER BY s.revoked ASC, s.created_at DESC`
    )
    .all(req.session.userId);
  res.render('shares', { shares });
});

// Create a share link granting read access to one specific file.
router.post('/files/:id/shares', requireAuth, (req, res) => {
  const file = db
    .prepare('SELECT * FROM files WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.session.userId);
  if (!file) {
    req.flash('error', 'File not found.');
    return res.redirect('/');
  }

  const token = crypto.randomBytes(24).toString('base64url');
  db.prepare(
    'INSERT INTO shares (file_id, user_id, token) VALUES (?, ?, ?)'
  ).run(file.id, req.session.userId, token);

  req.flash('success', `Share link created for "${file.original_name}".`);
  res.redirect('/shares');
});

// Revoke a share link (owner only).
router.post('/shares/:id/revoke', requireAuth, (req, res) => {
  const result = db
    .prepare('UPDATE shares SET revoked = 1 WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.session.userId);
  req.flash(
    result.changes ? 'success' : 'error',
    result.changes ? 'Share link revoked.' : 'Share link not found.'
  );
  res.redirect('/shares');
});

// ---- Public read access via share token (no login required) -----------------

function activeShare(token) {
  return db
    .prepare(
      `SELECT s.*, f.original_name, f.stored_name, f.mime_type, f.size_bytes,
              u.username AS owner
       FROM shares s
       JOIN files f ON f.id = s.file_id
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.revoked = 0`
    )
    .get(token);
}

// Landing page for a shared file.
router.get('/s/:token', (req, res) => {
  const share = activeShare(req.params.token);
  if (!share) {
    return res
      .status(404)
      .render('error', { message: 'This share link is invalid or has been revoked.' });
  }
  res.render('share', { share });
});

// Download the shared file (read-only access to that one file).
router.get('/s/:token/download', (req, res) => {
  const share = activeShare(req.params.token);
  if (!share) {
    return res
      .status(404)
      .render('error', { message: 'This share link is invalid or has been revoked.' });
  }
  res.download(
    storedFilePath(share.user_id, share.stored_name),
    share.original_name
  );
});

module.exports = router;
