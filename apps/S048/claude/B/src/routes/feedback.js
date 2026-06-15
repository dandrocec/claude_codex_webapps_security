'use strict';

const express = require('express');
const { body, validationResult } = require('express-validator');

const db = require('../db');
const { CATEGORIES } = require('../constants');

const router = express.Router();

// Public submission form.
router.get('/', (req, res) => {
  res.render('index', {
    categories: CATEGORIES,
    errors: [],
    values: { category: '', rating: '', comment: '' },
    submitted: req.query.submitted === '1',
  });
});

const validateFeedback = [
  body('category')
    .trim()
    .isIn(CATEGORIES)
    .withMessage('Please choose a valid category.'),
  body('rating')
    .trim()
    .isInt({ min: 1, max: 5 })
    .withMessage('Rating must be a whole number from 1 to 5.')
    .toInt(),
  body('comment')
    .trim()
    .isLength({ min: 1, max: 2000 })
    .withMessage('Comment is required and must be at most 2000 characters.'),
];

// Public submission handler.
router.post('/feedback', validateFeedback, (req, res) => {
  const result = validationResult(req);
  const values = {
    category: req.body.category || '',
    rating: req.body.rating || '',
    comment: req.body.comment || '',
  };

  if (!result.isEmpty()) {
    return res.status(400).render('index', {
      categories: CATEGORIES,
      errors: result.array().map((e) => e.msg),
      values,
      submitted: false,
    });
  }

  // Parameterised query — no string concatenation, so SQL injection is not
  // possible. Stored values are escaped on output by EJS, preventing stored XSS.
  db.prepare(
    'INSERT INTO feedback (category, rating, comment) VALUES (?, ?, ?)'
  ).run(values.category, values.rating, values.comment);

  res.redirect('/?submitted=1');
});

module.exports = router;
