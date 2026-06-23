'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');

const { users } = require('../repositories');

const router = express.Router();

// Throttle auth attempts to slow credential stuffing / brute force.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' },
});

const usernameRules = body('username')
  .isString()
  .trim()
  .isLength({ min: 3, max: 32 })
  .withMessage('Username must be 3–32 characters.')
  .matches(/^[A-Za-z0-9_]+$/)
  .withMessage('Username may contain only letters, numbers and underscores.');

const passwordRules = body('password')
  .isString()
  .isLength({ min: 8, max: 200 })
  .withMessage('Password must be at least 8 characters.');

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: errors.array()[0].msg });
    return false;
  }
  return true;
}

function publicUser(u) {
  return { id: u.id, username: u.username };
}

// POST /api/auth/register
router.post('/register', authLimiter, usernameRules, passwordRules, async (req, res, next) => {
  try {
    if (!validate(req, res)) return;
    const { username, password } = req.body;

    if (users.findByUsername(username)) {
      return res.status(409).json({ error: 'Username is already taken.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const id = users.create(username, passwordHash);

    // Establish a fresh session (prevents session fixation).
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = id;
      req.session.save((saveErr) => {
        if (saveErr) return next(saveErr);
        res.status(201).json({ user: { id, username } });
      });
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login
router.post('/login', authLimiter, usernameRules, passwordRules, async (req, res, next) => {
  try {
    if (!validate(req, res)) return;
    const { username, password } = req.body;

    const user = users.findByUsername(username);

    // Always run a hash comparison to keep timing uniform whether or not the
    // user exists, and return an identical generic message either way.
    const hash = user ? user.password_hash : '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva';
    const ok = await bcrypt.compare(password, hash);

    if (!user || !ok) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = user.id;
      req.session.save((saveErr) => {
        if (saveErr) return next(saveErr);
        res.json({ user: publicUser(user) });
      });
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('sid');
    res.json({ ok: true });
  });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }
  const user = users.findById(req.session.userId);
  if (!user) return res.status(401).json({ error: 'Not authenticated.' });
  res.json({ user: publicUser(user) });
});

module.exports = router;
