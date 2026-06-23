'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { body, param, validationResult } = require('express-validator');
const db = require('../db');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');
const upload = require('../middleware/upload');

const router = express.Router();

const idParam = param('id').isInt({ min: 1 }).toInt();

function fetchPhoto(id) {
  return db
    .prepare(
      `SELECT p.id, p.user_id, p.filename, p.caption, p.created_at, u.username
         FROM photos p JOIN users u ON u.id = p.user_id
        WHERE p.id = ?`
    )
    .get(id);
}

// ---- Upload form ----
router.get('/photos/new', requireAuth, (req, res) => {
  res.render('upload', { title: 'Upload a photo', errors: [], allowed: upload.allowedDescription });
});

// ---- Create photo ----
router.post(
  '/photos',
  requireAuth,
  upload.single,
  body('caption').optional({ values: 'falsy' }).trim().isLength({ max: 1000 }).withMessage('Caption too long.'),
  (req, res, next) => {
    try {
      const errors = validationResult(req);
      const renderError = (msg, status = 400) =>
        res.status(status).render('upload', {
          title: 'Upload a photo',
          errors: [{ msg }],
          allowed: upload.allowedDescription,
        });

      if (!errors.isEmpty()) return renderError(errors.array()[0].msg);
      if (!req.file) return renderError('Please choose an image to upload.');

      // Content-based validation: trust the bytes, not the filename/Content-Type.
      const detected = upload.detectImageType(req.file.buffer);
      if (!detected) {
        return renderError('Unsupported file. Allowed types: ' + upload.allowedDescription + '.', 415);
      }

      // Server-generated random name; the user-supplied filename is never used.
      const safeName = crypto.randomBytes(16).toString('hex') + '.' + detected.ext;
      const destPath = path.join(config.uploadDir, safeName);

      // Defense in depth: ensure the resolved path stays inside the upload dir.
      const resolved = path.resolve(destPath);
      if (path.dirname(resolved) !== path.resolve(config.uploadDir)) {
        return next(new Error('Resolved upload path escaped the upload directory.'));
      }

      fs.writeFileSync(resolved, req.file.buffer, { flag: 'wx' });

      const caption = (req.body.caption || '').trim();
      const result = db
        .prepare('INSERT INTO photos (user_id, filename, caption) VALUES (?, ?, ?)')
        .run(req.user.id, safeName, caption);

      req.flash('success', 'Photo uploaded.');
      res.redirect('/photos/' + result.lastInsertRowid);
    } catch (err) {
      next(err);
    }
  }
);

// ---- View a single photo ----
router.get('/photos/:id', idParam, (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return next(Object.assign(new Error('Not found'), { status: 404, expose: true }));

  const photo = fetchPhoto(req.params.id);
  if (!photo) return next(Object.assign(new Error('Photo not found'), { status: 404, expose: true }));

  const likeCount = db.prepare('SELECT COUNT(*) AS n FROM likes WHERE photo_id = ?').get(photo.id).n;
  const likedByMe = req.user
    ? !!db.prepare('SELECT 1 FROM likes WHERE photo_id = ? AND user_id = ?').get(photo.id, req.user.id)
    : false;
  const comments = db
    .prepare(
      `SELECT c.id, c.body, c.created_at, c.user_id, u.username
         FROM comments c JOIN users u ON u.id = c.user_id
        WHERE c.photo_id = ? ORDER BY c.created_at ASC`
    )
    .all(photo.id);

  res.render('photo', { title: photo.caption || 'Photo', photo, likeCount, likedByMe, comments });
});

// ---- Delete a photo (owner only — prevents IDOR) ----
router.post('/photos/:id/delete', requireAuth, idParam, (req, res, next) => {
  try {
    const photo = fetchPhoto(req.params.id);
    if (!photo) return next(Object.assign(new Error('Photo not found'), { status: 404, expose: true }));
    if (photo.user_id !== req.user.id) {
      return next(Object.assign(new Error('Forbidden'), { status: 403, expose: true }));
    }

    db.prepare('DELETE FROM photos WHERE id = ?').run(photo.id);

    // Remove the backing file (best effort, only within the upload dir).
    if (/^[a-f0-9]{32}\.(jpg|png|gif|webp)$/.test(photo.filename)) {
      fs.rm(path.join(config.uploadDir, photo.filename), { force: true }, () => {});
    }

    req.flash('success', 'Photo deleted.');
    res.redirect('/users/' + req.user.username);
  } catch (err) {
    next(err);
  }
});

// ---- Toggle like ----
router.post('/photos/:id/like', requireAuth, idParam, (req, res, next) => {
  try {
    const photo = db.prepare('SELECT id FROM photos WHERE id = ?').get(req.params.id);
    if (!photo) return next(Object.assign(new Error('Photo not found'), { status: 404, expose: true }));

    const existing = db.prepare('SELECT 1 FROM likes WHERE photo_id = ? AND user_id = ?').get(photo.id, req.user.id);
    if (existing) {
      db.prepare('DELETE FROM likes WHERE photo_id = ? AND user_id = ?').run(photo.id, req.user.id);
    } else {
      db.prepare('INSERT INTO likes (user_id, photo_id) VALUES (?, ?)').run(req.user.id, photo.id);
    }
    res.redirect('/photos/' + photo.id);
  } catch (err) {
    next(err);
  }
});

// ---- Add a comment ----
router.post(
  '/photos/:id/comments',
  requireAuth,
  idParam,
  body('body').trim().isLength({ min: 1, max: 1000 }).withMessage('Comment must be 1-1000 characters.'),
  (req, res, next) => {
    try {
      const photo = db.prepare('SELECT id FROM photos WHERE id = ?').get(req.params.id);
      if (!photo) return next(Object.assign(new Error('Photo not found'), { status: 404, expose: true }));

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        req.flash('error', errors.array()[0].msg);
        return res.redirect('/photos/' + photo.id);
      }

      db.prepare('INSERT INTO comments (photo_id, user_id, body) VALUES (?, ?, ?)').run(
        photo.id,
        req.user.id,
        req.body.body.trim()
      );
      res.redirect('/photos/' + photo.id);
    } catch (err) {
      next(err);
    }
  }
);

// ---- Delete a comment (comment author or photo owner only) ----
router.post('/comments/:id/delete', requireAuth, idParam, (req, res, next) => {
  try {
    const comment = db
      .prepare(
        `SELECT c.id, c.user_id, c.photo_id, p.user_id AS photo_owner
           FROM comments c JOIN photos p ON p.id = c.photo_id
          WHERE c.id = ?`
      )
      .get(req.params.id);
    if (!comment) return next(Object.assign(new Error('Comment not found'), { status: 404, expose: true }));

    if (comment.user_id !== req.user.id && comment.photo_owner !== req.user.id) {
      return next(Object.assign(new Error('Forbidden'), { status: 403, expose: true }));
    }

    db.prepare('DELETE FROM comments WHERE id = ?').run(comment.id);
    res.redirect('/photos/' + comment.photo_id);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
