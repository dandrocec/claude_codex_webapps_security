'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');

const db = require('../db');
const config = require('../config');
const filetype = require('../lib/filetype');
const { parseId } = require('../lib/validate');
const { requireAuth, verifyCsrf } = require('../middleware/security');

const router = express.Router();

// All file routes require an authenticated session.
router.use(requireAuth);

// --- Upload handling ------------------------------------------------------
// Store directly to disk under a server-generated random name. The user-
// supplied filename is never used to build a path.
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.uploadDir),
  filename: (req, file, cb) => {
    const name = crypto.randomBytes(24).toString('hex');
    cb(null, name); // no extension; type is tracked in DB
  },
});

const upload = multer({
  storage,
  limits: { fileSize: config.maxUploadBytes, files: 1 },
});

const insertFile = db.prepare(`
  INSERT INTO files (user_id, original_name, stored_name, mime_type, size)
  VALUES (?, ?, ?, ?, ?)
`);
const listFiles = db.prepare(
  'SELECT * FROM files WHERE user_id = ? ORDER BY created_at DESC'
);
const getFileForUser = db.prepare(
  'SELECT * FROM files WHERE id = ? AND user_id = ?'
);
const deleteFileRow = db.prepare(
  'DELETE FROM files WHERE id = ? AND user_id = ?'
);

// Sanitise an original filename purely for display/download header use.
function safeDisplayName(name, fallbackExt) {
  let base = path.basename(String(name || '')); // strip any path components
  base = base.replace(/[^\w.\- ]/g, '_').slice(0, 100).trim();
  if (!base) base = `upload.${fallbackExt}`;
  return base;
}

router.post('/upload', verifyCsrf, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).render('error', {
          status: 413,
          message: `File too large. Maximum size is ${Math.floor(
            config.maxUploadBytes / (1024 * 1024)
          )} MiB.`,
        });
      }
      return next(err);
    }

    if (!req.file) {
      return res.status(400).render('error', {
        status: 400,
        message: 'No file was uploaded.',
      });
    }

    const storedPath = path.join(config.uploadDir, req.file.filename);

    // Verify the real content type by inspecting magic bytes. Reject and
    // delete anything not on the allow-list.
    let detected;
    try {
      detected = filetype.detectFromFile(storedPath);
    } catch (e) {
      fs.unlink(storedPath, () => {});
      return next(e);
    }

    if (!detected || !filetype.ALLOWED_MIME.has(detected.mime)) {
      fs.unlink(storedPath, () => {});
      return res.status(415).render('error', {
        status: 415,
        message: `Unsupported file type. Allowed types: ${filetype.allowedDescription()}.`,
      });
    }

    const displayName = safeDisplayName(req.file.originalname, detected.ext);
    insertFile.run(
      req.session.userId,
      displayName,
      req.file.filename,
      detected.mime,
      req.file.size
    );

    res.redirect('/');
  });
});

// --- Owner download (authenticated) --------------------------------------
router.get('/files/:id/download', (req, res, next) => {
  const id = parseId(req.params.id);
  if (!id) return next();

  const file = getFileForUser.get(id, req.session.userId);
  if (!file) {
    return res.status(404).render('error', { status: 404, message: 'File not found.' });
  }
  sendStoredFile(res, file, next);
});

// --- Delete ---------------------------------------------------------------
router.post('/files/:id/delete', verifyCsrf, (req, res, next) => {
  const id = parseId(req.params.id);
  if (!id) return next();

  const file = getFileForUser.get(id, req.session.userId);
  if (!file) {
    return res.status(404).render('error', { status: 404, message: 'File not found.' });
  }

  deleteFileRow.run(id, req.session.userId); // shares cascade-delete via FK
  const stored = resolveWithinUploads(file.stored_name);
  if (stored) fs.unlink(stored, () => {});
  res.redirect('/');
});

// --- Shared helpers -------------------------------------------------------

// Resolve a stored filename to an absolute path and guarantee it stays inside
// the upload directory (defence-in-depth against path traversal).
function resolveWithinUploads(storedName) {
  const base = path.basename(String(storedName)); // never trust as path
  const resolved = path.resolve(config.uploadDir, base);
  const uploadRoot = path.resolve(config.uploadDir) + path.sep;
  if (!resolved.startsWith(uploadRoot)) return null;
  return resolved;
}

function sendStoredFile(res, file, next) {
  const abs = resolveWithinUploads(file.stored_name);
  if (!abs || !fs.existsSync(abs)) {
    return res.status(404).render('error', { status: 404, message: 'File not found.' });
  }
  res.type(file.mime_type);
  // Force download with a sanitised filename; prevents inline script execution
  // and content sniffing of the response.
  res.setHeader('Content-Disposition', `attachment; filename="${file.original_name}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(abs, (err) => {
    if (err) next(err);
  });
}

module.exports = { router, sendStoredFile, resolveWithinUploads, listFiles };
