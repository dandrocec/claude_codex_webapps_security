'use strict';

const express = require('express');
const { body, param, validationResult } = require('express-validator');

const models = require('../models');
const { requireAuth } = require('../middleware/security');
const { todayISO, currentStreak } = require('../lib/dates');

const router = express.Router();

// Every route here requires an authenticated user.
router.use(requireAuth);

// ---------------- Dashboard ----------------
router.get('/', (req, res) => {
  const userId = req.session.userId;
  const today = todayISO();

  const habits = models.listHabits(userId).map((h) => {
    const days = models.listCheckinDays(h.id);
    return {
      id: h.id,
      name: h.name,
      streak: currentStreak(days),
      doneToday: days.includes(today),
    };
  });

  res.render('dashboard', {
    title: 'My Habits',
    username: req.session.username,
    habits,
    today,
    errors: req.session.flashErrors || [],
  });
  req.session.flashErrors = null;
});

// ---------------- Create habit ----------------
router.post(
  '/habits',
  body('name')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Habit name must be 1-100 characters.'),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.session.flashErrors = errors.array().map((e) => e.msg);
      return res.redirect('/');
    }
    models.createHabit(req.session.userId, req.body.name.trim());
    res.redirect('/');
  }
);

// ---------------- Toggle today's check-in ----------------
router.post(
  '/habits/:id/toggle',
  param('id').isInt({ min: 1 }),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.redirect('/');
    }

    const habitId = Number(req.params.id);
    // Ownership check — prevents acting on another user's habit (IDOR).
    const habit = models.getOwnedHabit(habitId, req.session.userId);
    if (!habit) {
      return res.status(404).render('error', {
        title: 'Not found',
        message: 'Habit not found.',
      });
    }

    // Only allow toggling today's check-in.
    const day = todayISO();
    if (models.hasCheckin(habitId, day)) {
      models.removeCheckin(habitId, day);
    } else {
      models.addCheckin(habitId, day);
    }
    res.redirect('/');
  }
);

// ---------------- Delete habit ----------------
router.post(
  '/habits/:id/delete',
  param('id').isInt({ min: 1 }),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.redirect('/');
    }
    const habitId = Number(req.params.id);
    // deleteHabit scopes by user_id, so it is a no-op for non-owners.
    models.deleteHabit(habitId, req.session.userId);
    res.redirect('/');
  }
);

module.exports = router;
