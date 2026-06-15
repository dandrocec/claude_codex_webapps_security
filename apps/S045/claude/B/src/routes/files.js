'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const multer = require('multer');

const { statements } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { parseId } = require('../lib/validate');
const fileType = require('../lib/fileType');
const { UPLOAD_DIR, MAX_UPLOAD_BYTES } = require('../config');

const router = express.Router();

// Keep the upload in memory so we can inspect its real content BEFORE writing
// anything to disk. The size cap is enforced here by multer.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 10 },
});

/**
 * Resolve a stored filename to an absolute path and guarantee it stays inside
 * UPLOAD_DIR. Defence-in-depth against path traversal even though stored names
 * are server-generated.
 */
function resolveInsideUploads(storedName) {
  const safe = path.basename(storedName); // strip any directory components
  const abs = path.resolve(UPLOAD_DIR, safe);
  const root = path.resolve(UPLOAD_DIR) + path.sep;
  if (abs !== path.resolve(UPLOAD_DIR) && !abs.startsWith(root)) {
    return null;
  }
  return abs;
}

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(1)} ${units[i]}`;
}

// All routes below require an authenticated user.
router.use(requireAuth);

// List the current user's own uploads only.
router.get('/', (req, res) => {
  const userId = res.locals.currentUser.id;
  const files = statements.listFilesByOwner.all(userId).map((f) => ({
    ...f,
    size_human: humanSize(f.size_bytes),
  }));
  const flash = req.session.flash || null;
  req.session.flash = undefined;
  res.render('files', {
    title: 'My files',
    files,
    flash,
    maxSize: humanSize(MAX_UPLOAD_BYTES),
    allowed: fileType.ALLOWED_DESCRIPTION,
  });
});

// Upload a new file.
router.post('/', upload.single('file'), (req, res, next) => {
  try {
    if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
      req.session.flash = { type: 'error', message: 'Please choose a file to upload.' };
      return res.redirect('/files');
    }

    // Content-based validation: ignore the client's filename and Content-Type.
    const detected = fileType.detect(req.file.buffer);
    if (!detected) {
      req.session.flash = {
        type: 'error',
        message: `Unsupported file type. Allowed: ${fileType.ALLOWED_DESCRIPTION}.`,
      };
      return res.redirect('/files');
    }

    // Server-generated random name; the user-supplied name is never used on disk.
    const storedName = crypto.randomBytes(16).toString('hex') + detected.ext;
    const destination = resolveInsideUploads(storedName);
    if (!destination) {
      throw new Error('Resolved upload path escaped the upload directory.');
    }

    // Preserve a display name, but strip any path components and cap length.
    const originalName = path
      .basename(String(req.file.originalname || 'file'))
      .slice(0, 255);

    // Write with an exclusive flag so we never clobber an existing file.
    fs.writeFileSync(destination, req.file.buffer, { flag: 'wx' });

    statements.insertFile.run(
      res.locals.currentUser.id,
      storedName,
      originalName,
      detected.mime,
      req.file.buffer.length
    );

    req.session.flash = { type: 'success', message: 'File uploaded.' };
    res.redirect('/files');
  } catch (err) {
    next(err);
  }
});

// Download one of the current user's files.
router.get('/:id/download', (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) return next(); // -> 404

    // Ownership enforced in SQL: another user's id simply returns nothing.
    const file = statements.findFileForOwner.get(id, res.locals.currentUser.id);
    if (!file) return next(); // -> 404 (do not reveal existence)

    const abs = resolveInsideUploads(file.stored_name);
    if (!abs || !fs.existsSync(abs)) return next();

    // Force a download; never let the browser render/execute the content.
    res.setHeader('Content-Type', file.mime_type);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.download(abs, file.original_name); // sets Content-Disposition: attachment
  } catch (err) {
    next(err);
  }
});

// Delete one of the current user's files.
router.post('/:id/delete', (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) return next();

    const file = statements.findFileForOwner.get(id, res.locals.currentUser.id);
    if (!file) {
      req.session.flash = { type: 'error', message: 'File not found.' };
      return res.redirect('/files');
    }

    statements.deleteFileForOwner.run(id, res.locals.currentUser.id);

    const abs = resolveInsideUploads(file.stored_name);
    if (abs) {
      fs.rm(abs, { force: true }, () => {
        /* best-effort; DB row already removed */
      });
    }

    req.session.flash = { type: 'success', message: 'File deleted.' };
    res.redirect('/files');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
