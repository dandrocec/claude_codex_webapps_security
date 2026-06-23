'use strict';

const express = require('express');
const { body, param } = require('express-validator');

const db = require('../db');
const { handleValidation } = require('../validation');
const { requireAuth } = require('../middleware/auth');
const { verifyCsrf } = require('../middleware/csrf');

const router = express.Router();

// All task routes require authentication, and every state-changing request is
// CSRF-checked.
router.use(requireAuth);
router.use(verifyCsrf);

// Prepared (parameterised) statements — every query is scoped by user_id so a
// user can never read or mutate another user's tasks (prevents IDOR).
const stmts = {
  listByUser: db.prepare(
    `SELECT id, title, description, done, created_at, updated_at
       FROM tasks WHERE user_id = ? ORDER BY created_at DESC`
  ),
  getByIdForUser: db.prepare(
    `SELECT id, title, description, done, created_at, updated_at
       FROM tasks WHERE id = ? AND user_id = ?`
  ),
  insert: db.prepare(
    `INSERT INTO tasks (user_id, title, description, done)
       VALUES (?, ?, ?, ?)`
  ),
  update: db.prepare(
    `UPDATE tasks
        SET title = ?, description = ?, done = ?, updated_at = datetime('now')
      WHERE id = ? AND user_id = ?`
  ),
  remove: db.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?'),
};

/** Serialises a DB row to the API shape (done as boolean). */
function toTask(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    done: Boolean(row.done),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const idRule = param('id')
  .isInt({ min: 1 })
  .withMessage('Task id must be a positive integer.');

const titleRule = body('title')
  .isString()
  .trim()
  .isLength({ min: 1, max: 200 })
  .withMessage('Title is required (1-200 characters).');

const descriptionRule = body('description')
  .optional({ nullable: true })
  .isString()
  .trim()
  .isLength({ max: 5000 })
  .withMessage('Description must be at most 5000 characters.');

const doneRule = body('done')
  .optional()
  .isBoolean()
  .withMessage('done must be a boolean.')
  .toBoolean();

// GET /tasks — list current user's tasks
router.get('/', (req, res, next) => {
  try {
    const rows = stmts.listByUser.all(req.user.id);
    return res.json({ tasks: rows.map(toTask) });
  } catch (err) {
    return next(err);
  }
});

// POST /tasks — create a task
router.post(
  '/',
  titleRule,
  descriptionRule,
  doneRule,
  handleValidation,
  (req, res, next) => {
    try {
      const { title } = req.body;
      const description = req.body.description || '';
      const done = req.body.done ? 1 : 0;

      const info = stmts.insert.run(req.user.id, title, description, done);
      const row = stmts.getByIdForUser.get(info.lastInsertRowid, req.user.id);
      return res.status(201).json({ task: toTask(row) });
    } catch (err) {
      return next(err);
    }
  }
);

// GET /tasks/:id — read one of the current user's tasks
router.get('/:id', idRule, handleValidation, (req, res, next) => {
  try {
    const row = stmts.getByIdForUser.get(Number(req.params.id), req.user.id);
    if (!row) {
      return res.status(404).json({ error: 'Task not found.' });
    }
    return res.json({ task: toTask(row) });
  } catch (err) {
    return next(err);
  }
});

// PUT /tasks/:id — update one of the current user's tasks
router.put(
  '/:id',
  idRule,
  titleRule,
  descriptionRule,
  doneRule,
  handleValidation,
  (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const existing = stmts.getByIdForUser.get(id, req.user.id);
      if (!existing) {
        return res.status(404).json({ error: 'Task not found.' });
      }

      const title = req.body.title;
      const description =
        req.body.description !== undefined
          ? req.body.description || ''
          : existing.description;
      const done =
        req.body.done !== undefined ? (req.body.done ? 1 : 0) : existing.done;

      stmts.update.run(title, description, done, id, req.user.id);
      const row = stmts.getByIdForUser.get(id, req.user.id);
      return res.json({ task: toTask(row) });
    } catch (err) {
      return next(err);
    }
  }
);

// DELETE /tasks/:id — delete one of the current user's tasks
router.delete('/:id', idRule, handleValidation, (req, res, next) => {
  try {
    const info = stmts.remove.run(Number(req.params.id), req.user.id);
    if (info.changes === 0) {
      return res.status(404).json({ error: 'Task not found.' });
    }
    return res.status(204).end();
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
