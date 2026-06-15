'use strict';

const express = require('express');
const { body, param, validationResult } = require('express-validator');

const db = require('../db');
const { verifyToken } = require('../csrf');
const { requireAuth } = require('../auth');

const router = express.Router();

// Prepared statements — every query that touches user data is scoped by user_id
// so one account can never read or mutate another's redirects (IDOR defence).
const listForUser = db.prepare(
  'SELECT id, key, destination, created_at FROM redirects WHERE user_id = ? ORDER BY created_at DESC'
);
const findByKey = db.prepare('SELECT id FROM redirects WHERE key = ?');
const insertRedirect = db.prepare(
  'INSERT INTO redirects (user_id, key, destination) VALUES (?, ?, ?)'
);
const deleteOwned = db.prepare(
  'DELETE FROM redirects WHERE id = ? AND user_id = ?'
);

function renderDashboard(req, res, opts = {}) {
  const redirects = listForUser.all(req.session.userId);
  res.status(opts.status || 200).render('dashboard', {
    username: req.session.username,
    redirects,
    errors: opts.errors || [],
    values: opts.values || {},
  });
}

router.get('/dashboard', requireAuth, (req, res) => {
  renderDashboard(req, res);
});

const keyRule = body('key')
  .trim()
  .isLength({ min: 1, max: 64 })
  .withMessage('Key is required (max 64 characters).')
  .matches(/^[a-zA-Z0-9_-]+$/)
  .withMessage('Key may only contain letters, numbers, hyphens and underscores.');

// Only allow real web destinations. Rejecting non-http(s) schemes blocks
// javascript:/data: payloads (stored XSS via redirect) and other abuse.
const destinationRule = body('destination')
  .trim()
  .isLength({ max: 2048 })
  .withMessage('Destination URL is too long.')
  .isURL({ protocols: ['http', 'https'], require_protocol: true })
  .withMessage('Destination must be a valid http(s) URL.');

router.post(
  '/redirects',
  requireAuth,
  verifyToken,
  keyRule,
  destinationRule,
  (req, res, next) => {
    const errors = validationResult(req);
    const values = { key: req.body.key, destination: req.body.destination };

    if (!errors.isEmpty()) {
      return renderDashboard(req, res, {
        status: 400,
        errors: errors.array(),
        values,
      });
    }

    try {
      if (findByKey.get(req.body.key)) {
        return renderDashboard(req, res, {
          status: 409,
          errors: [{ msg: 'That key is already in use. Choose another.' }],
          values,
        });
      }

      insertRedirect.run(req.session.userId, req.body.key, req.body.destination);
      res.redirect('/dashboard');
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/redirects/:id/delete',
  requireAuth,
  verifyToken,
  param('id').isInt({ min: 1 }),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.redirect('/dashboard');
    }
    try {
      // The AND user_id = ? clause guarantees a user can only delete their own.
      deleteOwned.run(Number(req.params.id), req.session.userId);
      res.redirect('/dashboard');
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
