'use strict';

const express = require('express');

const db = require('../db');
const { requireReviewer } = require('../middleware/auth');
const { SORT_COLUMNS, SORT_DIRECTIONS } = require('../constants');

const router = express.Router();

// Every route in this file requires an authenticated reviewer.
router.use(requireReviewer);

router.get('/dashboard', (req, res) => {
  // Resolve sort options through allow-lists. Anything unexpected falls back to
  // a safe default, so user input never reaches the SQL string directly.
  const sortKey = SORT_COLUMNS[req.query.sort] ? req.query.sort : 'created_at';
  const dirKey = SORT_DIRECTIONS[req.query.dir] ? req.query.dir : 'desc';

  const column = SORT_COLUMNS[sortKey];
  const direction = SORT_DIRECTIONS[dirKey];

  const rows = db
    .prepare(
      `SELECT id, category, rating, comment, created_at
         FROM feedback
        ORDER BY ${column} ${direction}, id DESC`
    )
    .all();

  res.render('dashboard', {
    rows,
    sort: sortKey,
    dir: dirKey,
  });
});

module.exports = router;
