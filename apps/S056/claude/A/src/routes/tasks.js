'use strict';

const express = require('express');

const db = require('../db');
const { authenticate } = require('../auth');

const router = express.Router();

// Every task route requires a valid JWT.
router.use(authenticate);

function serialize(task) {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    done: task.done,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// GET /tasks  — list the authenticated user's tasks
router.get('/', (req, res) => {
  const tasks = db.listTasks(req.user.id).map(serialize);
  res.json(tasks);
});

// POST /tasks — create a task
router.post('/', (req, res) => {
  const body = req.body || {};
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) return res.status(400).json({ error: 'title is required' });

  const task = db.createTask(req.user.id, {
    title,
    description: typeof body.description === 'string' ? body.description : '',
    done: body.done,
  });
  res.status(201).json(serialize(task));
});

// GET /tasks/:id — read one task
router.get('/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid task id' });

  const task = db.findTask(req.user.id, id);
  if (!task) return res.status(404).json({ error: 'task not found' });
  res.json(serialize(task));
});

// PUT /tasks/:id — update a task
router.put('/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid task id' });

  const body = req.body || {};
  const patch = {};
  if (body.title !== undefined) {
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) return res.status(400).json({ error: 'title cannot be empty' });
    patch.title = title;
  }
  if (body.description !== undefined) patch.description = String(body.description);
  if (body.done !== undefined) patch.done = body.done;

  const task = db.updateTask(req.user.id, id, patch);
  if (!task) return res.status(404).json({ error: 'task not found' });
  res.json(serialize(task));
});

// DELETE /tasks/:id — delete a task
router.delete('/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid task id' });

  const deleted = db.deleteTask(req.user.id, id);
  if (!deleted) return res.status(404).json({ error: 'task not found' });
  res.status(204).end();
});

module.exports = router;
