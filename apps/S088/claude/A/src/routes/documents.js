'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { db, STORAGE_DIR } = require('../db');
const { requireAuth, asyncHandler } = require('../middleware');
const { can, documentPermission } = require('../permissions');

const router = express.Router();
router.use(requireAuth);

// Store uploads on disk under storage/ with a random, collision-free name.
// The original filename is kept in the database, not on disk.
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, STORAGE_DIR),
  filename: (req, file, cb) =>
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`),
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

/** Insert a new version row and point the document at it. Runs in a tx. */
const addVersion = db.transaction((documentId, fileMeta, uploadedBy, note) => {
  const last = db
    .prepare(
      'SELECT MAX(version_number) AS n FROM document_versions WHERE document_id = ?'
    )
    .get(documentId);
  const versionNumber = (last.n || 0) + 1;

  const info = db
    .prepare(
      `INSERT INTO document_versions
         (document_id, version_number, stored_name, original_name, mime_type, size, uploaded_by, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      documentId,
      versionNumber,
      fileMeta.stored_name,
      fileMeta.original_name,
      fileMeta.mime_type,
      fileMeta.size,
      uploadedBy,
      note || null
    );

  db.prepare('UPDATE documents SET current_version_id = ? WHERE id = ?').run(
    info.lastInsertRowid,
    documentId
  );
  return { versionId: info.lastInsertRowid, versionNumber };
});

// --- List documents (in a folder, or all visible to the user) ------------
router.get(
  '/',
  asyncHandler((req, res) => {
    const uid = req.session.userId;
    const folderId = req.query.folderId ? Number(req.query.folderId) : null;

    let docs;
    if (folderId) {
      docs = db
        .prepare('SELECT * FROM documents WHERE folder_id = ? ORDER BY name')
        .all(folderId);
    } else {
      docs = db.prepare('SELECT * FROM documents ORDER BY name').all();
    }

    const visible = docs
      .map((d) => {
        const perm = documentPermission(uid, d.id);
        if (perm === 'none') return null;
        const ver = d.current_version_id
          ? db.prepare('SELECT * FROM document_versions WHERE id = ?').get(d.current_version_id)
          : null;
        return {
          id: d.id,
          name: d.name,
          folder_id: d.folder_id,
          owner_id: d.owner_id,
          permission: perm,
          current_version: ver
            ? { number: ver.version_number, size: ver.size, original_name: ver.original_name }
            : null,
          created_at: d.created_at,
        };
      })
      .filter(Boolean);

    res.json(visible);
  })
);

// --- Create a document = upload its first version ------------------------
router.post(
  '/',
  upload.single('file'),
  asyncHandler((req, res) => {
    if (!req.file) return res.status(400).json({ error: 'file is required' });
    const { name, folderId } = req.body || {};

    if (folderId) {
      const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(folderId);
      if (!folder) {
        fs.unlinkSync(req.file.path);
        return res.status(404).json({ error: 'folder not found' });
      }
      if (!can.editFolder(req.session.userId, Number(folderId))) {
        fs.unlinkSync(req.file.path);
        return res.status(403).json({ error: 'no permission to add to this folder' });
      }
    }

    const docName = name || req.file.originalname;
    const info = db
      .prepare(
        'INSERT INTO documents (name, folder_id, owner_id) VALUES (?, ?, ?)'
      )
      .run(docName, folderId || null, req.session.userId);

    const { versionNumber } = addVersion(
      info.lastInsertRowid,
      {
        stored_name: req.file.filename,
        original_name: req.file.originalname,
        mime_type: req.file.mimetype,
        size: req.file.size,
      },
      req.session.userId,
      req.body.note
    );

    res.status(201).json({ id: info.lastInsertRowid, name: docName, version: versionNumber });
  })
);

// --- Upload a new version of an existing document ------------------------
router.post(
  '/:id/versions',
  upload.single('file'),
  asyncHandler((req, res) => {
    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
    if (!doc) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'document not found' });
    }
    if (!can.editDocument(req.session.userId, doc.id)) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(403).json({ error: 'edit permission required' });
    }
    if (!req.file) return res.status(400).json({ error: 'file is required' });

    const { versionNumber } = addVersion(
      doc.id,
      {
        stored_name: req.file.filename,
        original_name: req.file.originalname,
        mime_type: req.file.mimetype,
        size: req.file.size,
      },
      req.session.userId,
      req.body.note
    );
    res.status(201).json({ id: doc.id, version: versionNumber });
  })
);

// --- Version history -----------------------------------------------------
router.get(
  '/:id/versions',
  asyncHandler((req, res) => {
    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
    if (!doc) return res.status(404).json({ error: 'document not found' });
    if (!can.viewDocument(req.session.userId, doc.id)) {
      return res.status(403).json({ error: 'view permission required' });
    }
    const versions = db
      .prepare(
        `SELECT v.id, v.version_number, v.original_name, v.mime_type, v.size,
                v.note, v.created_at, u.username AS uploaded_by
           FROM document_versions v JOIN users u ON u.id = v.uploaded_by
          WHERE v.document_id = ?
          ORDER BY v.version_number DESC`
      )
      .all(doc.id);
    res.json({
      document: { id: doc.id, name: doc.name, current_version_id: doc.current_version_id },
      versions,
    });
  })
);

// --- Restore a previous version -----------------------------------------
// Restoring copies the chosen version's file into a brand-new version so the
// full history is preserved (non-destructive restore).
router.post(
  '/:id/restore/:versionId',
  asyncHandler((req, res) => {
    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
    if (!doc) return res.status(404).json({ error: 'document not found' });
    if (!can.editDocument(req.session.userId, doc.id)) {
      return res.status(403).json({ error: 'edit permission required' });
    }
    const source = db
      .prepare('SELECT * FROM document_versions WHERE id = ? AND document_id = ?')
      .get(req.params.versionId, doc.id);
    if (!source) return res.status(404).json({ error: 'version not found' });

    // Copy the stored file to a new name so versions never share a file.
    const newStored = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
    fs.copyFileSync(
      path.join(STORAGE_DIR, source.stored_name),
      path.join(STORAGE_DIR, newStored)
    );

    const { versionNumber } = addVersion(
      doc.id,
      {
        stored_name: newStored,
        original_name: source.original_name,
        mime_type: source.mime_type,
        size: source.size,
      },
      req.session.userId,
      `Restored from version ${source.version_number}`
    );
    res.status(201).json({ id: doc.id, version: versionNumber, restored_from: source.version_number });
  })
);

// --- Download a version (defaults to the current one) --------------------
router.get(
  '/:id/download',
  asyncHandler((req, res) => {
    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
    if (!doc) return res.status(404).json({ error: 'document not found' });
    if (!can.viewDocument(req.session.userId, doc.id)) {
      return res.status(403).json({ error: 'view permission required' });
    }
    const versionId = req.query.versionId || doc.current_version_id;
    const version = db
      .prepare('SELECT * FROM document_versions WHERE id = ? AND document_id = ?')
      .get(versionId, doc.id);
    if (!version) return res.status(404).json({ error: 'version not found' });

    const filePath = path.join(STORAGE_DIR, version.stored_name);
    if (!fs.existsSync(filePath)) return res.status(410).json({ error: 'file missing on disk' });
    res.download(filePath, version.original_name);
  })
);

router.delete(
  '/:id',
  asyncHandler((req, res) => {
    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
    if (!doc) return res.status(404).json({ error: 'document not found' });
    if (doc.owner_id !== req.session.userId) {
      return res.status(403).json({ error: 'only the owner can delete a document' });
    }
    // Remove the underlying files, then the rows (versions cascade).
    const versions = db
      .prepare('SELECT stored_name FROM document_versions WHERE document_id = ?')
      .all(doc.id);
    for (const v of versions) {
      const p = path.join(STORAGE_DIR, v.stored_name);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    db.prepare('DELETE FROM documents WHERE id = ?').run(doc.id);
    res.json({ ok: true });
  })
);

module.exports = router;
