'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');

const { Users } = require('../models');

const router = express.Router();

// Throttle authentication attempts to slow down credential-stuffing / brute force.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many attempts from this IP. Please try again later.',
});

const usernameRules = body('username')
  .trim()
  .isLength({ min: 3, max: 30 })
  .withMessage('Username must be 3–30 characters.')
  .matches(/^[a-zA-Z0-9_.-]+$/)
  .withMessage('Username may only contain letters, numbers, and . _ -');

const passwordRules = body('password')
  .isLength({ min: 8, max: 200 })
  .withMessage('Password must be at least 8 characters.');

// --- Registration -----------------------------------------------------------

router.get('/register', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('register', { errors: [], values: {} });
});

router.post('/register', authLimiter, usernameRules, passwordRules, async (req, res, next) => {
  try {
    const errors = validationResult(req);
    const values = { username: req.body.username };

    if (!errors.isEmpty()) {
      return res.status(400).render('register', { errors: errors.array(), values });
    }

    const username = req.body.username.trim();

    if (Users.findByUsername(username)) {
      return res.status(409).render('register', {
        errors: [{ msg: 'That username is already taken.' }],
        values,
      });
    }

    // bcrypt automatically generates a per-password random salt.
    const passwordHash = await bcrypt.hash(req.body.password, 12);
    const userId = Users.create(username, passwordHash);

    // Regenerate the session on privilege change to prevent session fixation.
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = { id: userId, username };
      req.session.flash = { type: 'success', message: 'Welcome! Your account was created.' };
      res.redirect('/');
    });
  } catch (err) {
    next(err);
  }
});

// --- Login ------------------------------------------------------------------

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { errors: [], values: {} });
});

router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const values = { username };

    const genericError = [{ msg: 'Invalid username or password.' }];
    const user = Users.findByUsername(username);

    // Always run a hash comparison to keep timing roughly constant whether or
    // not the user exists, and never reveal which field was wrong.
    const hash = user ? user.password_hash : '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
    const ok = await bcrypt.compare(password, hash);

    if (!user || !ok) {
      return res.status(401).render('login', { errors: genericError, values });
    }

    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = { id: user.id, username: user.username };
      req.session.flash = { type: 'success', message: 'Logged in successfully.' };
      res.redirect('/');
    });
  } catch (err) {
    next(err);
  }
});

// --- Logout -----------------------------------------------------------------

router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('sid');
    res.redirect('/login');
  });
});

module.exports = router;
