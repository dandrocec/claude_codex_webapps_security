'use strict';

const express = require('express');
const { body, query, param, validationResult } = require('express-validator');

const db = require('../db');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Every route here requires a logged-in user.
router.use(requireAuth);

// --- Date helpers -----------------------------------------------------------
function todayISO() {
  // Local date in YYYY-MM-DD.
  const now = new Date();
  const tz = now.getTimezoneOffset() * 60000;
  return new Date(now - tz).toISOString().slice(0, 10);
}

function isWithinHorizon(dateStr) {
  const today = todayISO();
  const max = new Date(today + 'T00:00:00');
  max.setDate(max.getDate() + config.bookingHorizonDays - 1);
  const maxStr = max.toISOString().slice(0, 10);
  return dateStr >= today && dateStr <= maxStr;
}

// A strict, real-calendar date check (rejects 2026-02-31 etc.).
function isValidISODate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + 'T00:00:00');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// --- Availability (home) ----------------------------------------------------
router.get(
  '/',
  query('date').optional().trim(),
  (req, res) => {
    let date = req.query.date;
    if (!date || !isValidISODate(date) || !isWithinHorizon(date)) {
      date = todayISO();
    }

    const rooms = db.prepare('SELECT id, name, description FROM rooms ORDER BY name').all();

    // All bookings for the selected date. Parameterised query — no string concat.
    const dayBookings = db
      .prepare('SELECT room_id, slot, user_id FROM bookings WHERE date = ?')
      .all(date);

    // Build a lookup: "roomId|slot" -> { mine: bool }
    const taken = new Map();
    for (const b of dayBookings) {
      taken.set(`${b.room_id}|${b.slot}`, { mine: b.user_id === req.session.userId });
    }

    const grid = rooms.map((room) => ({
      room,
      cells: config.slots.map((slot) => {
        const entry = taken.get(`${room.id}|${slot}`);
        return {
          slot,
          status: !entry ? 'free' : entry.mine ? 'mine' : 'taken',
        };
      }),
    }));

    res.render('availability', {
      title: 'Availability',
      date,
      slots: config.slots,
      grid,
      horizonDays: config.bookingHorizonDays,
    });
  },
);

// --- Create a booking -------------------------------------------------------
router.post(
  '/book',
  body('room_id').toInt().isInt({ min: 1 }),
  body('date').trim().custom((v) => isValidISODate(v)).withMessage('Invalid date.'),
  body('slot').trim().isIn(config.slots).withMessage('Invalid time slot.'),
  (req, res, next) => {
    const errors = validationResult(req);
    const date = req.body.date;
    const redirectBack = `/?date=${encodeURIComponent(isValidISODate(date) ? date : todayISO())}`;

    if (!errors.isEmpty()) {
      req.flash('error', errors.array()[0].msg || 'Invalid booking request.');
      return res.redirect(redirectBack);
    }

    if (!isWithinHorizon(date)) {
      req.flash('error', `You can only book dates within the next ${config.bookingHorizonDays} days.`);
      return res.redirect(redirectBack);
    }

    try {
      const room = db.prepare('SELECT id FROM rooms WHERE id = ?').get(req.body.room_id);
      if (!room) {
        req.flash('error', 'That room does not exist.');
        return res.redirect(redirectBack);
      }

      db.prepare(
        'INSERT INTO bookings (user_id, room_id, date, slot) VALUES (?, ?, ?, ?)',
      ).run(req.session.userId, req.body.room_id, date, req.body.slot);

      req.flash('success', 'Room booked successfully.');
      return res.redirect(redirectBack);
    } catch (err) {
      // The UNIQUE(room_id, date, slot) constraint atomically prevents
      // double-booking even under concurrent requests.
      if (err && /UNIQUE constraint failed/i.test(err.message)) {
        req.flash('error', 'Sorry, that slot was just booked by someone else.');
        return res.redirect(redirectBack);
      }
      return next(err);
    }
  },
);

// --- My bookings ------------------------------------------------------------
router.get('/bookings', (req, res) => {
  const bookings = db
    .prepare(
      `SELECT b.id, b.date, b.slot, r.name AS room_name
         FROM bookings b
         JOIN rooms r ON r.id = b.room_id
        WHERE b.user_id = ?
        ORDER BY b.date ASC, b.slot ASC`,
    )
    .all(req.session.userId);

  res.render('bookings', { title: 'My bookings', bookings, today: todayISO() });
});

// --- Cancel a booking (ownership enforced) ----------------------------------
router.post(
  '/bookings/:id/cancel',
  param('id').toInt().isInt({ min: 1 }),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash('error', 'Invalid booking reference.');
      return res.redirect('/bookings');
    }

    // The user_id predicate is the access-control check: a user can only ever
    // delete their OWN booking, preventing IDOR. A mismatched/foreign id simply
    // affects zero rows.
    const result = db
      .prepare('DELETE FROM bookings WHERE id = ? AND user_id = ?')
      .run(req.params.id, req.session.userId);

    if (result.changes > 0) {
      req.flash('success', 'Booking cancelled.');
    } else {
      req.flash('error', 'Booking not found.');
    }
    return res.redirect('/bookings');
  },
);

module.exports = router;
