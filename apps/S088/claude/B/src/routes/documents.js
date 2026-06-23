'use strict';

const fs = require('fs');
const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../middleware');
const {
  documentPermission,
  canView,
  canEdit,
  folderOwnedBy,
  groupVisibleTo,
} = require('../access');
const { cleanName, toId, flash, verifyCsrf } = require('../security');
const {
  memoryUpload,
  sniffType,
  storeBuffer,
  resolveStoredPath,
  deleteStored,
  MAX_UPLOAD_BYTES,
} = require('../upload');

const router = express.Router();

// ---- Prepared statements --------------------------------------------------
const insertDocument = db.prepare(
  'INSERT INTO documents (folder_id, owner_id, name) VALUES (?, ?, ?)'
);
const setCurrentVersion = db.prepare('UPDATE documents SET current_version_id = ? WHERE id = ?');
const nextVersionNo = db.prepare(
  'SELECT COALESCE(MAX(version_number), 0) + 1 AS n FROM document_versions WHERE document_id = ?'
);
const insertVersion = db.prepare(
  `INSERT INTO document_versions
     (document_id, version_number, stored_filename, original_filename, mime_type, size, uploaded_by, note)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
);
const getVersion = db.prepare('SELECT * FROM document_versions WHERE id = ? AND document_id = ?');
const listVersions = db.prepare(
  `SELECT v.*, u.username AS uploader
     FROM document_versions v
     LEFT JOIN users u ON u.id = v.uploaded_by
    WHERE v.document_id = ?
    ORDER BY v.version_number DESC`
);
const listShares = db.prepare(
  `SELECT s.*,
          CASE WHEN s.subject_type = 'user' THEN u.username ELSE g.name END AS subject_label
     FROM shares s
     LEFT JOIN users u ON s.subject_type = 'user' AND u.id = s.subject_id
     LEFT JOIN groups g ON s.subject_type = 'group' AND g.id = s.subject_id
    WHERE s.document_id = ?
    ORDER BY s.created_at`
);
const findUserByUsername = db.prepare('SELECT id, username FROM users WHERE username = ?');
const upsertShare = db.prepare(
  `INSERT INTO shares (document_id, subject_type, subject_id, permission, created_by)
   VALUES (?, ?, ?, ?, ?)
   ON CONFLICT(document_id, subject_type, subject_id)
   DO UPDATE SET permission = excluded.permission`
);
const deleteShareStmt = db.prepare('DELETE FROM shares WHERE id = ? AND document_id = ?');
const listGroupsForOwner = db.prepare(
  `SELECT DISTINCT g.id, g.name FROM groups g
     LEFT JOIN group_members gm ON gm.group_id = g.id
    WHERE g.owner_id = ? OR gm.user_id = ?
    ORDER BY g.name COLLATE NOCASE`
);

// Helper: load a document and the caller's permission, or send the right error.
function requirePermission(req, res, needEdit) {
  const docId = toId(req.params.id);
  if (!docId) {
    res.status(404).render('error', { status: 404, message: 'Document not found.' });
    return null;
  }
  const { doc, level } = documentPermission(docId, req.user.id);
  if (!doc || !canView(level)) {
    res.status(404).render('error', { status: 404, message: 'Document not found.' });
    return null;
  }
  if (needEdit && !canEdit(level)) {
    res.status(403).render('error', { status: 403, message: 'You do not have edit rights on this document.' });
    return null;
  }
  return { doc, level };
}

// ---- Create a document (upload first version) into one of MY folders ------
router.post('/folders/:id/documents', requireAuth, (req, res, next) => {
  memoryUpload.single('file')(req, res, (err) => {
    if (err) return handleUploadError(err, res, `/folders/${req.params.id}`, req);
    // CSRF for multipart is verified here, once Multer has parsed the body.
    if (!verifyCsrf(req)) {
      return res.status(403).render('error', { status: 403, message: 'Invalid or missing CSRF token. Please reload the page and try again.' });
    }

    const folderId = toId(req.params.id);
    const folder = folderId && folderOwnedBy(folderId, req.user.id);
    if (!folder) {
      return res.status(404).render('error', { status: 404, message: 'Folder not found.' });
    }
    if (!req.file) {
      flash(req, 'error', 'Please choose a file to upload.');
      return res.redirect(`/folders/${folderId}`);
    }

    const kind = sniffType(req.file.buffer);
    if (!kind) {
      flash(req, 'error', 'Unsupported file type. Allowed: PDF, PNG, JPEG, GIF, plain text.');
      return res.redirect(`/folders/${folderId}`);
    }

    const docName = cleanName(req.body.name) || cleanName(req.file.originalname) || `document.${kind.ext}`;
    const stored = storeBuffer(req.file.buffer);

    try {
      const tx = db.transaction(() => {
        const docInfo = insertDocument.run(folderId, req.user.id, docName);
        const docId = docInfo.lastInsertRowid;
        const n = nextVersionNo.get(docId).n;
        const vInfo = insertVersion.run(
          docId, n, stored, req.file.originalname.slice(0, 255), kind.mime, req.file.size, req.user.id, 'Initial upload'
        );
        setCurrentVersion.run(vInfo.lastInsertRowid, docId);
        return docId;
      });
      const docId = tx();
      flash(req, 'success', 'Document uploaded.');
      res.redirect(`/documents/${docId}`);
    } catch (e) {
      deleteStored(stored); // roll back the orphaned file
      next(e);
    }
  });
});

// ---- View a document (anyone with view rights) ----------------------------
router.get('/documents/:id', requireAuth, (req, res) => {
  const ctx = requirePermission(req, res, false);
  if (!ctx) return;
  const versions = listVersions.all(ctx.doc.id);
  const isOwner = ctx.level === 'owner';
  res.render('document', {
    doc: ctx.doc,
    level: ctx.level,
    canEdit: canEdit(ctx.level),
    isOwner,
    versions,
    shares: isOwner ? listShares.all(ctx.doc.id) : [],
    myGroups: isOwner ? listGroupsForOwner.all(req.user.id, req.user.id) : [],
  });
});

// ---- Upload a new version (edit rights) -----------------------------------
router.post('/documents/:id/versions', requireAuth, (req, res, next) => {
  memoryUpload.single('file')(req, res, (err) => {
    if (err) return handleUploadError(err, res, `/documents/${req.params.id}`, req);
    if (!verifyCsrf(req)) {
      return res.status(403).render('error', { status: 403, message: 'Invalid or missing CSRF token. Please reload the page and try again.' });
    }

    const ctx = requirePermission(req, res, true);
    if (!ctx) return;
    if (!req.file) {
      flash(req, 'error', 'Please choose a file to upload.');
      return res.redirect(`/documents/${ctx.doc.id}`);
    }
    const kind = sniffType(req.file.buffer);
    if (!kind) {
      flash(req, 'error', 'Unsupported file type. Allowed: PDF, PNG, JPEG, GIF, plain text.');
      return res.redirect(`/documents/${ctx.doc.id}`);
    }

    const note = cleanName(req.body.note, 200) || null;
    const stored = storeBuffer(req.file.buffer);
    try {
      const tx = db.transaction(() => {
        const n = nextVersionNo.get(ctx.doc.id).n;
        const vInfo = insertVersion.run(
          ctx.doc.id, n, stored, req.file.originalname.slice(0, 255), kind.mime, req.file.size, req.user.id, note
        );
        setCurrentVersion.run(vInfo.lastInsertRowid, ctx.doc.id);
      });
      tx();
      flash(req, 'success', 'New version uploaded.');
    } catch (e) {
      deleteStored(stored);
      return next(e);
    }
    res.redirect(`/documents/${ctx.doc.id}`);
  });
});

// ---- Restore a previous version (edit rights) -----------------------------
// Creates a NEW version whose bytes are a copy of the chosen older version, so
// history is never lost.
router.post('/documents/:id/restore', requireAuth, (req, res, next) => {
  const ctx = requirePermission(req, res, true);
  if (!ctx) return;

  const versionId = toId(req.body.version_id);
  const source = versionId && getVersion.get(versionId, ctx.doc.id);
  if (!source) {
    flash(req, 'error', 'Version not found.');
    return res.redirect(`/documents/${ctx.doc.id}`);
  }

  const srcPath = resolveStoredPath(source.stored_filename);
  if (!srcPath || !fs.existsSync(srcPath)) {
    return next(new Error('Stored file missing for version ' + versionId));
  }

  // Copy bytes into a fresh server-generated file.
  const buf = fs.readFileSync(srcPath);
  const stored = storeBuffer(buf);
  try {
    const tx = db.transaction(() => {
      const n = nextVersionNo.get(ctx.doc.id).n;
      const vInfo = insertVersion.run(
        ctx.doc.id, n, stored, source.original_filename, source.mime_type, source.size, req.user.id,
        `Restored from v${source.version_number}`
      );
      setCurrentVersion.run(vInfo.lastInsertRowid, ctx.doc.id);
    });
    tx();
    flash(req, 'success', `Restored version ${source.version_number} as the latest version.`);
  } catch (e) {
    deleteStored(stored);
    return next(e);
  }
  res.redirect(`/documents/${ctx.doc.id}`);
});

// ---- Download a specific version (view rights) ----------------------------
router.get('/documents/:id/versions/:vid/download', requireAuth, (req, res, next) => {
  const ctx = requirePermission(req, res, false);
  if (!ctx) return;

  const vid = toId(req.params.vid);
  const version = vid && getVersion.get(vid, ctx.doc.id);
  if (!version) {
    return res.status(404).render('error', { status: 404, message: 'Version not found.' });
  }
  const filePath = resolveStoredPath(version.stored_filename);
  if (!filePath || !fs.existsSync(filePath)) {
    return next(new Error('Stored file missing for version ' + vid));
  }

  // Force a download and forbid content sniffing so nothing is ever executed
  // or rendered inline in a way that could enable stored XSS.
  const safeName = encodeURIComponent(version.original_filename || `version-${version.version_number}`);
  res.setHeader('Content-Type', version.mime_type || 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${safeName}`);
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  fs.createReadStream(filePath).on('error', next).pipe(res);
});

// ---- Sharing (owner only) -------------------------------------------------
router.post('/documents/:id/shares', requireAuth, (req, res) => {
  const ctx = requirePermission(req, res, false);
  if (!ctx) return;
  if (ctx.level !== 'owner') {
    return res.status(403).render('error', { status: 403, message: 'Only the owner can manage sharing.' });
  }

  const subjectType = req.body.subject_type === 'group' ? 'group' : 'user';
  const permission = req.body.permission === 'edit' ? 'edit' : 'view';
  const redirect = `/documents/${ctx.doc.id}`;

  if (subjectType === 'user') {
    const username = (req.body.username || '').trim();
    const target = findUserByUsername.get(username);
    if (!target) {
      flash(req, 'error', 'No such user.');
      return res.redirect(redirect);
    }
    if (target.id === req.user.id) {
      flash(req, 'error', 'You already own this document.');
      return res.redirect(redirect);
    }
    upsertShare.run(ctx.doc.id, 'user', target.id, permission, req.user.id);
  } else {
    const groupId = toId(req.body.group_id);
    // Owner may only share with a group they own or belong to.
    const group = groupId && groupVisibleTo(groupId, req.user.id);
    if (!group) {
      flash(req, 'error', 'No such group.');
      return res.redirect(redirect);
    }
    upsertShare.run(ctx.doc.id, 'group', group.id, permission, req.user.id);
  }
  flash(req, 'success', 'Sharing updated.');
  res.redirect(redirect);
});

router.post('/documents/:id/shares/:sid/delete', requireAuth, (req, res) => {
  const ctx = requirePermission(req, res, false);
  if (!ctx) return;
  if (ctx.level !== 'owner') {
    return res.status(403).render('error', { status: 403, message: 'Only the owner can manage sharing.' });
  }
  const sid = toId(req.params.sid);
  if (sid) deleteShareStmt.run(sid, ctx.doc.id);
  flash(req, 'success', 'Share removed.');
  res.redirect(`/documents/${ctx.doc.id}`);
});

// ---- Delete a document (owner only) ---------------------------------------
router.post('/documents/:id/delete', requireAuth, (req, res) => {
  const ctx = requirePermission(req, res, false);
  if (!ctx) return;
  if (ctx.level !== 'owner') {
    return res.status(403).render('error', { status: 403, message: 'Only the owner can delete this document.' });
  }
  const folderId = ctx.doc.folder_id;
  const versions = listVersions.all(ctx.doc.id);
  db.prepare('DELETE FROM documents WHERE id = ?').run(ctx.doc.id);
  // Remove the on-disk blobs after the rows are gone.
  versions.forEach((v) => deleteStored(v.stored_filename));
  flash(req, 'success', 'Document deleted.');
  res.redirect(`/folders/${folderId}`);
});

function handleUploadError(err, res, redirect, req) {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    flash(req, 'error', `File too large. Maximum size is ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`);
  } else {
    flash(req, 'error', 'Upload failed. Please try again.');
  }
  return res.redirect(redirect);
}

module.exports = router;
