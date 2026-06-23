'use strict';

const express = require('express');
const fs = require('fs');
const db = require('../db');
const { requireAuth } = require('../auth');
const { upload, storedFilePath } = require('../storage');

const router = express.Router();

router.use(requireAuth);

// Dashboard: the current user's files.
router.get('/', (req, res) => {
  const files = db
    .prepare(
      `SELECT f.*,
              (SELECT COUNT(*) FROM shares s
               WHERE s.file_id = f.id AND s.revoked = 0) AS active_shares
       FROM files f
       WHERE f.user_id = ?
       ORDER BY f.created_at DESC`
    )
    .all(req.session.userId);
  res.render('dashboard', { files });
});

// Upload a file into the user's personal folder.
router.post('/files', upload.single('file'), (req, res) => {
  if (!req.file) {
    req.flash('error', 'Please choose a file to upload.');
    return res.redirect('/');
  }
  db.prepare(
    `INSERT INTO files (user_id, original_name, stored_name, mime_type, size_bytes)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    req.session.userId,
    req.file.originalname,
    req.file.filename,
    req.file.mimetype || 'application/octet-stream',
    req.file.size
  );
  req.flash('success', `Uploaded "${req.file.originalname}".`);
  res.redirect('/');
});

// Owner downloads their own file.
router.get('/files/:id/download', (req, res) => {
  const file = db
    .prepare('SELECT * FROM files WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.session.userId);
  if (!file) return res.status(404).render('error', { message: 'File not found.' });

  res.download(storedFilePath(file.user_id, file.stored_name), file.original_name);
});

// Delete a file (and, by cascade, its share links and on-disk blob).
router.post('/files/:id/delete', (req, res) => {
  const file = db
    .prepare('SELECT * FROM files WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.session.userId);
  if (!file) {
    req.flash('error', 'File not found.');
    return res.redirect('/');
  }

  db.prepare('DELETE FROM files WHERE id = ?').run(file.id);
  fs.rm(storedFilePath(file.user_id, file.stored_name), { force: true }, () => {});

  req.flash('success', `Deleted "${file.original_name}".`);
  res.redirect('/');
});

module.exports = router;
