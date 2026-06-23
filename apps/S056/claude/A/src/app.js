'use strict';

const express = require('express');

const usersRouter = require('./routes/users');
const tasksRouter = require('./routes/tasks');

function createApp() {
  const app = express();

  app.use(express.json());

  // Health check
  app.get('/', (req, res) => {
    res.json({ status: 'ok', service: 'task-management-api' });
  });

  // Auth routes (POST /register, POST /login)
  app.use('/', usersRouter);

  // Task routes (all under /tasks, JWT-protected)
  app.use('/tasks', tasksRouter);

  // 404 fallback
  app.use((req, res) => {
    res.status(404).json({ error: 'not found' });
  });

  // Centralized error handler — catches bad JSON bodies, etc.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'invalid JSON body' });
    }
    console.error(err);
    return res.status(500).json({ error: 'internal server error' });
  });

  return app;
}

module.exports = createApp;
