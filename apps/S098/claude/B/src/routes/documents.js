'use strict';

const express = require('express');
const { body, param, validationResult } = require('express-validator');

const { users, documents, access, effectivePermission } = require('../repositories');

const router = express.Router();

const MAX_TITLE = 200;
const MAX_CONTENT = 200_000; // ~200 KB of text per document.

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: errors.array()[0].msg });
    return false;
  }
  return true;
}

const idParam = param('id').isInt({ min: 1 }).toInt();

/**
 * Load the document and attach the caller's effective permission, enforcing a
 * minimum required level. Centralises authorisation so no route trusts the
 * client for ownership/permission (prevents IDOR).
 *
 * Returns 404 (not 403) when the user has no access at all, so we don't reveal
 * the existence of documents they cannot see.
 */
function requirePermission(minLevel) {
  const rank = { view: 1, edit: 2, owner: 3 };
  return (req, res, next) => {
    const docId = Number(req.params.id);
    if (!Number.isInteger(docId) || docId < 1) {
      return res.status(400).json({ error: 'Invalid document id.' });
    }
    const { doc, permission } = effectivePermission(docId, req.session.userId);
    if (!doc || !permission) {
      return res.status(404).json({ error: 'Document not found.' });
    }
    if (rank[permission] < rank[minLevel]) {
      return res.status(403).json({ error: 'You do not have permission to perform this action.' });
    }
    req.document = doc;
    req.permission = permission;
    next();
  };
}

// GET /api/documents  — list documents the user can see.
router.get('/', (req, res) => {
  const docs = documents.listForUser(req.session.userId);
  res.json({ documents: docs });
});

// POST /api/documents  — create a document.
router.post(
  '/',
  body('title').isString().trim().isLength({ min: 1, max: MAX_TITLE })
    .withMessage(`Title must be 1–${MAX_TITLE} characters.`),
  body('content').optional().isString().isLength({ max: MAX_CONTENT })
    .withMessage('Content is too large.'),
  (req, res) => {
    if (!validate(req, res)) return;
    const title = req.body.title.trim();
    const content = typeof req.body.content === 'string' ? req.body.content : '';
    const id = documents.create(title, content, req.session.userId);
    const doc = documents.findById(id);
    res.status(201).json({ document: { ...doc, permission: 'owner' } });
  }
);

// GET /api/documents/:id  — fetch a single document (view or higher).
router.get('/:id', idParam, requirePermission('view'), (req, res) => {
  res.json({ document: { ...req.document, permission: req.permission } });
});

// PUT /api/documents/:id  — update content and/or title (edit or higher).
router.put(
  '/:id',
  idParam,
  body('content').optional().isString().isLength({ max: MAX_CONTENT })
    .withMessage('Content is too large.'),
  body('title').optional().isString().trim().isLength({ min: 1, max: MAX_TITLE })
    .withMessage(`Title must be 1–${MAX_TITLE} characters.`),
  requirePermission('edit'),
  (req, res) => {
    if (!validate(req, res)) return;
    if (typeof req.body.content === 'string') {
      documents.updateContent(req.document.id, req.body.content);
    }
    if (typeof req.body.title === 'string') {
      documents.updateTitle(req.document.id, req.body.title.trim());
    }
    res.json({ document: documents.findById(req.document.id) });
  }
);

// DELETE /api/documents/:id  — owner only.
router.delete('/:id', idParam, requirePermission('owner'), (req, res) => {
  documents.remove(req.document.id);
  res.json({ ok: true });
});

// ---- Collaborators -------------------------------------------------------

// GET /api/documents/:id/collaborators  — anyone with access can see the list.
router.get('/:id/collaborators', idParam, requirePermission('view'), (req, res) => {
  const owner = users.findById(req.document.owner_id);
  const collaborators = access.listForDocument(req.document.id);
  res.json({
    owner: owner ? { user_id: owner.id, username: owner.username, permission: 'owner' } : null,
    collaborators,
    youAreOwner: req.permission === 'owner',
  });
});

// POST /api/documents/:id/collaborators  — owner invites a user (view/edit).
router.post(
  '/:id/collaborators',
  idParam,
  body('username').isString().trim().isLength({ min: 1, max: 32 }),
  body('permission').isIn(['view', 'edit']).withMessage('Permission must be "view" or "edit".'),
  requirePermission('owner'),
  (req, res) => {
    if (!validate(req, res)) return;
    const target = users.findByUsername(req.body.username);
    if (!target) {
      return res.status(404).json({ error: 'No user with that username.' });
    }
    if (target.id === req.document.owner_id) {
      return res.status(400).json({ error: 'The owner already has full access.' });
    }
    access.grant(req.document.id, target.id, req.body.permission);
    res.status(201).json({
      collaborator: { user_id: target.id, username: target.username, permission: req.body.permission },
    });
  }
);

// PUT /api/documents/:id/collaborators/:userId  — owner changes permission.
router.put(
  '/:id/collaborators/:userId',
  idParam,
  param('userId').isInt({ min: 1 }).toInt(),
  body('permission').isIn(['view', 'edit']).withMessage('Permission must be "view" or "edit".'),
  requirePermission('owner'),
  (req, res) => {
    if (!validate(req, res)) return;
    const userId = Number(req.params.userId);
    if (access.get(req.document.id, userId) === null) {
      return res.status(404).json({ error: 'That user is not a collaborator.' });
    }
    access.grant(req.document.id, userId, req.body.permission);
    res.json({ ok: true });
  }
);

// DELETE /api/documents/:id/collaborators/:userId  — owner revokes access.
router.delete(
  '/:id/collaborators/:userId',
  idParam,
  param('userId').isInt({ min: 1 }).toInt(),
  requirePermission('owner'),
  (req, res) => {
    if (!validate(req, res)) return;
    access.revoke(req.document.id, Number(req.params.userId));
    res.json({ ok: true });
  }
);

module.exports = router;
