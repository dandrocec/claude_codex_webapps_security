'use strict';

const crypto = require('crypto');
const express = require('express');

const db = require('../db');
const { parseId } = require('../lib/validate');
const { requireAuth, verifyCsrf } = require('../middleware/security');
const { sendStoredFile } = require('./files');

const router = express.Router();

const getFileForUser = db.prepare('SELECT * FROM files WHERE id = ? AND user_id = ?');
const insertShare = db.prepare(
  'INSERT INTO shares (token, file_id, user_id) VALUES (?, ?, ?)'
);
const listSharesForUser = db.prepare(`
  SELECT s.id, s.token, s.revoked, s.created_at,
         f.original_name, f.id AS file_id
  FROM shares s
  JOIN files f ON f.id = s.file_id
  WHERE s.user_id = ?
  ORDER BY s.created_at DESC
`);
const getShareForUser = db.prepare('SELECT * FROM shares WHERE id = ? AND user_id = ?');
const revokeShareStmt = db.prepare(
  'UPDATE shares SET revoked = 1 WHERE id = ? AND user_id = ?'
);
const getActiveShareByToken = db.prepare(`
  SELECT s.*, f.stored_name, f.mime_type, f.original_name
  FROM shares s
  JOIN files f ON f.id = s.file_id
  WHERE s.token = ? AND s.revoked = 0
`);

// --- Management UI (auth required) ---------------------------------------
router.get('/shares', requireAuth, (req, res) => {
  const shares = listSharesForUser.all(req.session.userId);
  res.render('shares', { shares });
});

// Create a share link for one of the user's own files (IDOR-safe).
router.post('/shares', requireAuth, verifyCsrf, (req, res) => {
  const fileId = parseId(req.body.fileId);
  if (!fileId) {
    return res.status(400).render('error', { status: 400, message: 'Invalid file.' });
  }

  const file = getFileForUser.get(fileId, req.session.userId);
  if (!file) {
    // Either the file doesn't exist or isn't theirs — same response.
    return res.status(404).render('error', { status: 404, message: 'File not found.' });
  }

  const token = crypto.randomBytes(32).toString('base64url');
  insertShare.run(token, file.id, req.session.userId);
  res.redirect('/shares');
});

router.post('/shares/:id/revoke', requireAuth, verifyCsrf, (req, res, next) => {
  const id = parseId(req.params.id);
  if (!id) return next();

  const share = getShareForUser.get(id, req.session.userId);
  if (!share) {
    return res.status(404).render('error', { status: 404, message: 'Share not found.' });
  }
  revokeShareStmt.run(id, req.session.userId);
  res.redirect('/shares');
});

// --- Public read access via share token (no auth) ------------------------
// Read-only: the token grants download of exactly one file and nothing else.
router.get('/s/:token', (req, res, next) => {
  const token = String(req.params.token || '');
  if (!/^[A-Za-z0-9_-]{10,128}$/.test(token)) {
    return res.status(404).render('error', { status: 404, message: 'Invalid share link.' });
  }

  const share = getActiveShareByToken.get(token);
  if (!share) {
    return res.status(404).render('error', {
      status: 404,
      message: 'This share link is invalid or has been revoked.',
    });
  }

  sendStoredFile(res, share, next);
});

module.exports = router;
