'use strict';

const express = require('express');
const { body, validationResult } = require('express-validator');

const db = require('../db');
const { requireAuth } = require('../middleware/security');

const router = express.Router();

// All statements use bound parameters; ownership is enforced in the WHERE clause
// (user_id = ?) so one user can never read or mutate another user's events (IDOR).
const listEventsForUser = db.prepare(
  'SELECT * FROM events WHERE user_id = ? ORDER BY target_at ASC'
);
const getEventForUser = db.prepare(
  'SELECT * FROM events WHERE id = ? AND user_id = ?'
);
const insertEvent = db.prepare(
  'INSERT INTO events (user_id, label, target_at) VALUES (?, ?, ?)'
);
const deleteEventForUser = db.prepare(
  'DELETE FROM events WHERE id = ? AND user_id = ?'
);

const eventRules = [
  body('label')
    .trim()
    .isLength({ min: 1, max: 120 })
    .withMessage('Label must be 1-120 characters.'),
  // Accept an HTML datetime-local value (YYYY-MM-DDTHH:MM) or full ISO 8601.
  body('target')
    .trim()
    .notEmpty()
    .withMessage('Please choose a target date and time.')
    .custom((value) => {
      const ms = Date.parse(value);
      if (Number.isNaN(ms)) {
        throw new Error('That is not a valid date and time.');
      }
      return true;
    }),
];

// Everything below requires a logged-in user.
router.use(requireAuth);

// Dashboard: the form plus the current user's countdowns.
router.get('/', (req, res) => {
  const events = listEventsForUser.all(req.session.userId);
  res.render('dashboard', {
    title: 'Your countdowns',
    events,
    errors: [],
    values: {},
  });
});

router.post('/events', eventRules, (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const events = listEventsForUser.all(req.session.userId);
    return res.status(400).render('dashboard', {
      title: 'Your countdowns',
      events,
      errors: errors.array().map((e) => e.msg),
      values: { label: req.body.label, target: req.body.target },
    });
  }

  // Normalise to a canonical ISO string for reliable client-side parsing.
  const targetIso = new Date(Date.parse(req.body.target)).toISOString();
  const result = insertEvent.run(req.session.userId, req.body.label, targetIso);

  res.redirect(`/events/${result.lastInsertRowid}`);
});

router.get('/events/:id', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) {
    return res.status(404).render('error', {
      title: 'Not found',
      message: 'That countdown does not exist.',
    });
  }

  const event = getEventForUser.get(id, req.session.userId);
  if (!event) {
    // Either the event does not exist or it belongs to another user. Returning
    // 404 in both cases avoids confirming the existence of others' resources.
    return res.status(404).render('error', {
      title: 'Not found',
      message: 'That countdown does not exist.',
    });
  }

  res.render('countdown', { title: event.label, event });
});

router.post('/events/:id/delete', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (Number.isInteger(id)) {
    deleteEventForUser.run(id, req.session.userId);
  }
  res.redirect('/');
});

module.exports = router;
