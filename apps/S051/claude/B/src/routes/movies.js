'use strict';

const express = require('express');
const { body, validationResult } = require('express-validator');

const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const VALID_STATUSES = ['to_watch', 'watching', 'watched'];
const STATUS_LABELS = {
  to_watch: 'To watch',
  watching: 'Watching',
  watched: 'Watched',
};

// Prepared statements — all scoped by user_id for access control (no IDOR).
const insertMovie = db.prepare(
  `INSERT INTO movies (user_id, title, year, status, rating)
   VALUES (@user_id, @title, @year, @status, @rating)`
);
const listAll = db.prepare(
  'SELECT * FROM movies WHERE user_id = ? ORDER BY created_at DESC'
);
const listByStatus = db.prepare(
  `SELECT * FROM movies WHERE user_id = ? AND status = ?
   ORDER BY created_at DESC`
);
const deleteMovie = db.prepare(
  'DELETE FROM movies WHERE id = ? AND user_id = ?'
);

const currentYear = new Date().getFullYear();

const movieValidators = [
  body('title')
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('Title is required (max 200 characters).'),
  body('year')
    .trim()
    .isInt({ min: 1888, max: currentYear + 5 })
    .withMessage(`Year must be between 1888 and ${currentYear + 5}.`),
  body('status')
    .trim()
    .isIn(VALID_STATUSES)
    .withMessage('Please choose a valid status.'),
  body('rating')
    .optional({ values: 'falsy' })
    .isInt({ min: 1, max: 10 })
    .withMessage('Rating must be a whole number from 1 to 10.'),
];

// ---- List + filter ---------------------------------------------------------

router.get('/movies', requireAuth, (req, res) => {
  const filter = req.query.status;
  const activeFilter = VALID_STATUSES.includes(filter) ? filter : 'all';

  const movies =
    activeFilter === 'all'
      ? listAll.all(req.session.userId)
      : listByStatus.all(req.session.userId, activeFilter);

  res.render('movies', {
    movies,
    activeFilter,
    statusLabels: STATUS_LABELS,
    validStatuses: VALID_STATUSES,
    errors: [],
    values: {},
  });
});

// ---- Create ----------------------------------------------------------------

router.post('/movies', requireAuth, movieValidators, (req, res, next) => {
  const result = validationResult(req);

  if (!result.isEmpty()) {
    const movies = listAll.all(req.session.userId);
    return res.status(400).render('movies', {
      movies,
      activeFilter: 'all',
      statusLabels: STATUS_LABELS,
      validStatuses: VALID_STATUSES,
      errors: result.array().map((e) => e.msg),
      values: req.body,
    });
  }

  try {
    insertMovie.run({
      user_id: req.session.userId,
      title: req.body.title.trim(),
      year: parseInt(req.body.year, 10),
      status: req.body.status,
      rating: req.body.rating ? parseInt(req.body.rating, 10) : null,
    });
    res.redirect('/movies');
  } catch (err) {
    next(err);
  }
});

// ---- Delete ----------------------------------------------------------------

router.post('/movies/:id/delete', requireAuth, (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) {
    return res.status(400).redirect('/movies');
  }
  try {
    // The WHERE clause ties the row to the session user, so a user can never
    // delete another user's movie even by guessing an id.
    deleteMovie.run(id, req.session.userId);
    res.redirect('/movies');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
