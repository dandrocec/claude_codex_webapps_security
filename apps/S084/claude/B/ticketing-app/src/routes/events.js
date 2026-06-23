'use strict';

const express = require('express');
const { body, param, validationResult } = require('express-validator');

const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// All event mutations require authentication.
const eventValidators = [
  body('name').trim().notEmpty().withMessage('Name is required.').isLength({ max: 200 }),
  body('description').trim().isLength({ max: 5000 }).optional({ values: 'falsy' }),
  body('event_date')
    .optional({ values: 'falsy' })
    .trim()
    .matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('Date must be in YYYY-MM-DD format.'),
  body('capacity')
    .toInt()
    .isInt({ min: 1, max: 1000000 }).withMessage('Capacity must be a whole number of at least 1.'),
];

// --- List all events ------------------------------------------------------

router.get('/events', requireAuth, (req, res) => {
  const events = db
    .prepare(
      `SELECT e.id, e.name, e.description, e.event_date, e.capacity, e.tickets_sold,
              u.email AS organiser_email, e.organiser_id
       FROM events e
       JOIN users u ON u.id = e.organiser_id
       ORDER BY e.created_at DESC`
    )
    .all();

  res.render('events/index', { title: 'Events', events });
});

// --- New event form -------------------------------------------------------

router.get('/events/new', requireAuth, (req, res) => {
  res.render('events/new', { title: 'Create event', errors: [], values: {} });
});

// --- Create event ---------------------------------------------------------

router.post('/events', requireAuth, eventValidators, (req, res, next) => {
  try {
    const errors = validationResult(req);
    const values = {
      name: (req.body.name || '').trim(),
      description: (req.body.description || '').trim(),
      event_date: (req.body.event_date || '').trim(),
      capacity: req.body.capacity,
    };

    if (!errors.isEmpty()) {
      return res.status(400).render('events/new', {
        title: 'Create event',
        errors: errors.array().map((e) => e.msg),
        values,
      });
    }

    const info = db
      .prepare(
        `INSERT INTO events (organiser_id, name, description, event_date, capacity)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        req.session.userId,
        values.name,
        values.description,
        values.event_date || null,
        values.capacity
      );

    res.redirect(`/events/${info.lastInsertRowid}`);
  } catch (err) {
    next(err);
  }
});

// --- Event detail ---------------------------------------------------------

router.get(
  '/events/:id',
  requireAuth,
  param('id').toInt().isInt({ min: 1 }),
  (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return next(); // -> 404 handler

      const event = db
        .prepare(
          `SELECT e.id, e.name, e.description, e.event_date, e.capacity, e.tickets_sold,
                  u.email AS organiser_email, e.organiser_id
           FROM events e
           JOIN users u ON u.id = e.organiser_id
           WHERE e.id = ?`
        )
        .get(req.params.id);

      if (!event) return next(); // -> 404 handler

      // How many tickets does the current user already hold for this event?
      const owned = db
        .prepare('SELECT COUNT(*) AS n FROM tickets WHERE event_id = ? AND user_id = ?')
        .get(event.id, req.session.userId).n;

      res.render('events/show', { title: event.name, event, owned });
    } catch (err) {
      next(err);
    }
  }
);

// --- Buy a ticket (atomic, oversell-safe) ---------------------------------

router.post(
  '/events/:id/buy',
  requireAuth,
  param('id').toInt().isInt({ min: 1 }),
  (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return next();

      const eventId = req.params.id;
      const userId = req.session.userId;

      // Atomic purchase. The guarded UPDATE only succeeds while capacity
      // remains; combined with the row-level transaction this makes oversell
      // impossible even under concurrent requests. The DB CHECK constraint
      // (tickets_sold <= capacity) is a final backstop.
      const purchase = db.transaction((evId, uId) => {
        const updated = db
          .prepare(
            `UPDATE events
             SET tickets_sold = tickets_sold + 1
             WHERE id = ? AND tickets_sold < capacity`
          )
          .run(evId);

        if (updated.changes !== 1) {
          return { ok: false, reason: 'soldout' };
        }

        db.prepare('INSERT INTO tickets (event_id, user_id) VALUES (?, ?)').run(evId, uId);
        return { ok: true };
      });

      const exists = db.prepare('SELECT 1 FROM events WHERE id = ?').get(eventId);
      if (!exists) return next(); // 404

      const result = purchase(eventId, userId);

      if (!result.ok) {
        const event = db
          .prepare(
            `SELECT e.id, e.name, e.description, e.event_date, e.capacity, e.tickets_sold,
                    u.email AS organiser_email, e.organiser_id
             FROM events e JOIN users u ON u.id = e.organiser_id
             WHERE e.id = ?`
          )
          .get(eventId);
        const owned = db
          .prepare('SELECT COUNT(*) AS n FROM tickets WHERE event_id = ? AND user_id = ?')
          .get(eventId, userId).n;
        return res.status(409).render('events/show', {
          title: event.name,
          event,
          owned,
          flash: 'Sorry — this event is sold out.',
        });
      }

      res.redirect('/my-tickets');
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
