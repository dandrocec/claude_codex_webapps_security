'use strict';

const express = require('express');
const { body, param, validationResult } = require('express-validator');

const db = require('../db');
const { requireAuth, verifyCsrf } = require('../middleware/auth');

const router = express.Router();

// Prepared statements — all scoped by user_id to enforce ownership (anti-IDOR).
const listTasks = db.prepare(
  'SELECT * FROM tasks WHERE user_id = ? ORDER BY completed ASC, created_at DESC'
);
const getTask = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?');
const insertTask = db.prepare(
  'INSERT INTO tasks (user_id, title) VALUES (?, ?)'
);
const updateTitle = db.prepare(
  'UPDATE tasks SET title = ? WHERE id = ? AND user_id = ?'
);
const toggleComplete = db.prepare(
  'UPDATE tasks SET completed = ? WHERE id = ? AND user_id = ?'
);
const deleteTask = db.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?');

// Every route below requires authentication.
router.use(requireAuth);

const titleRules = body('title')
  .trim()
  .isLength({ min: 1, max: 200 })
  .withMessage('Task must be between 1 and 200 characters.');

const idRule = param('id').isInt({ min: 1 }).toInt();

// --- List ------------------------------------------------------------------

router.get('/tasks', (req, res) => {
  const tasks = listTasks.all(req.session.userId);
  res.render('tasks', { tasks, errors: [] });
});

// --- Create ----------------------------------------------------------------

router.post('/tasks', verifyCsrf, titleRules, (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const tasks = listTasks.all(req.session.userId);
    return res.status(400).render('tasks', { tasks, errors: errors.array() });
  }
  insertTask.run(req.session.userId, req.body.title.trim());
  res.redirect('/tasks');
});

// --- Edit (show form) ------------------------------------------------------

router.get('/tasks/:id/edit', idRule, (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.redirect('/tasks');

  const task = getTask.get(req.params.id, req.session.userId);
  if (!task) {
    return res.status(404).render('error', {
      statusCode: 404,
      message: 'Task not found.',
    });
  }
  res.render('edit', { task, errors: [] });
});

// --- Edit (submit) ---------------------------------------------------------

router.post('/tasks/:id/edit', verifyCsrf, idRule, titleRules, (req, res) => {
  const errors = validationResult(req);
  const task = getTask.get(req.params.id, req.session.userId);

  if (!task) {
    return res.status(404).render('error', {
      statusCode: 404,
      message: 'Task not found.',
    });
  }
  if (!errors.isEmpty()) {
    return res.status(400).render('edit', { task, errors: errors.array() });
  }

  updateTitle.run(req.body.title.trim(), req.params.id, req.session.userId);
  res.redirect('/tasks');
});

// --- Toggle complete -------------------------------------------------------

router.post('/tasks/:id/toggle', verifyCsrf, idRule, (req, res) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) {
    const task = getTask.get(req.params.id, req.session.userId);
    if (task) {
      toggleComplete.run(task.completed ? 0 : 1, task.id, req.session.userId);
    }
  }
  res.redirect('/tasks');
});

// --- Delete ----------------------------------------------------------------

router.post('/tasks/:id/delete', verifyCsrf, idRule, (req, res) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) {
    deleteTask.run(req.params.id, req.session.userId);
  }
  res.redirect('/tasks');
});

module.exports = router;
