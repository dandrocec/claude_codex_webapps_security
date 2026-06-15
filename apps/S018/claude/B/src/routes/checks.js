'use strict';

const express = require('express');
const { body, param, validationResult } = require('express-validator');

const db = require('../db');
const { requireAuth } = require('../security');
const { evaluatePassword, MAX_LENGTH } = require('../strength');

const router = express.Router();

function renderDashboard(req, res, extra = {}) {
  res.render('dashboard', {
    checks: db.listChecksForUser(req.session.userId),
    result: null,
    candidateLength: null,
    errors: [],
    savedLabel: '',
    ...extra,
  });
}

router.get('/dashboard', requireAuth, (req, res) => {
  renderDashboard(req, res);
});

const checkValidators = [
  // We must evaluate the literal characters, so we do NOT sanitise the
  // password value — only bound its length to limit work (DoS) and type.
  body('password')
    .isString()
    .withMessage('Password is required.')
    .bail()
    .isLength({ min: 1, max: MAX_LENGTH })
    .withMessage(`Password must be 1–${MAX_LENGTH} characters.`),
  // The label is rendered back to the page, so trim + escape it.
  body('label').optional({ values: 'falsy' }).trim().isLength({ max: 60 }).escape(),
  body('save').optional().toBoolean(),
];

router.post('/check', requireAuth, checkValidators, (req, res) => {
  const result = validationResult(req);
  if (!result.isEmpty()) {
    return res.status(400).render('dashboard', {
      checks: db.listChecksForUser(req.session.userId),
      result: null,
      candidateLength: null,
      errors: result.array().map((e) => e.msg),
      savedLabel: '',
    });
  }

  const evaluation = evaluatePassword(req.body.password);
  const candidateLength = req.body.password.length;

  // Optionally persist ONLY the rating (never the password) for this user.
  let savedLabel = '';
  if (req.body.save) {
    const label = (req.body.label || '').trim() || 'Untitled check';
    db.insertCheck(req.session.userId, label, evaluation.rating, evaluation.score);
    savedLabel = label;
  }

  return res.render('dashboard', {
    checks: db.listChecksForUser(req.session.userId),
    result: evaluation,
    candidateLength,
    errors: [],
    savedLabel,
  });
});

router.post(
  '/checks/:id/delete',
  requireAuth,
  param('id').isInt({ min: 1 }),
  (req, res) => {
    const result = validationResult(req);
    if (!result.isEmpty()) {
      return res.status(400).render('error', {
        status: 400,
        message: 'Invalid request.',
      });
    }

    // Deletion is scoped to the owning user — a user cannot delete another
    // user's record even by guessing the id (prevents IDOR / OWASP A01).
    db.deleteCheckForUser(Number(req.params.id), req.session.userId);
    return res.redirect('/dashboard');
  }
);

module.exports = router;
