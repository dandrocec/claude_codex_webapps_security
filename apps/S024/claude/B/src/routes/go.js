'use strict';

const express = require('express');
const { query, validationResult } = require('express-validator');

const db = require('../db');

const router = express.Router();

const findDestination = db.prepare(
  'SELECT destination FROM redirects WHERE key = ?'
);

// Defence in depth: even though destinations are validated on insert, re-check
// the scheme before issuing the redirect so we never bounce a visitor to a
// javascript:/data: URL.
function isSafeHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

router.get(
  '/go',
  query('to')
    .trim()
    .isLength({ min: 1, max: 64 })
    .matches(/^[a-zA-Z0-9_-]+$/),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).render('error', { message: 'Invalid redirect key.' });
    }

    const row = findDestination.get(req.query.to);
    if (!row || !isSafeHttpUrl(row.destination)) {
      return res.status(404).render('error', { message: 'No such redirect.' });
    }

    // 302 so the link remains a pointer rather than being cached permanently.
    return res.redirect(302, row.destination);
  }
);

module.exports = router;
