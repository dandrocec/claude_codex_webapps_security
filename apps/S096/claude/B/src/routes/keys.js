'use strict';

const express = require('express');
const { body, param, validationResult } = require('express-validator');
const apiKeys = require('../services/apiKeys');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

// Create a new API key for the logged-in developer.
router.post(
  '/',
  body('label')
    .trim()
    .isLength({ min: 1, max: 60 })
    .withMessage('Label must be between 1 and 60 characters.'),
  body('rateLimit')
    .optional({ checkFalsy: true })
    .toInt()
    .isInt({ min: 1, max: 100000 })
    .withMessage('Rate limit must be a positive integer.'),
  (req, res) => {
    const errors = validationResult(req).array().map((e) => e.msg);
    if (errors.length) {
      req.session.flash = { type: 'error', messages: errors };
      return res.redirect('/dashboard');
    }
    const rateLimit = req.body.rateLimit
      ? parseInt(req.body.rateLimit, 10)
      : apiKeys.defaultRateLimit;
    const created = apiKeys.createKey(req.user.id, req.body.label, rateLimit);
    // Surface the plaintext key exactly once via a one-time flash.
    req.session.flash = {
      type: 'key',
      newKey: created.plaintext,
      messages: ['Copy your new API key now — it will not be shown again.'],
    };
    res.redirect('/dashboard');
  }
);

// Revoke a key. The service layer scopes the update by user_id, so a developer
// cannot revoke someone else's key even by guessing the id (IDOR protection).
router.post(
  '/:id/revoke',
  param('id').toInt().isInt({ min: 1 }),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.session.flash = { type: 'error', messages: ['Invalid key id.'] };
      return res.redirect('/dashboard');
    }
    const revoked = apiKeys.revokeKey(req.params.id, req.user.id);
    req.session.flash = revoked
      ? { type: 'success', messages: ['API key revoked.'] }
      : { type: 'error', messages: ['Key not found.'] };
    res.redirect('/dashboard');
  }
);

module.exports = router;
