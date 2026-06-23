'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');

const { users } = require('../models');
const { redirectIfAuth } = require('../middleware/auth');

const router = express.Router();

// A valid throwaway hash compared against when a username is unknown, so login
// timing doesn't reveal whether an account exists (mitigates user enumeration).
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password-placeholder', 12);

// Throttle authentication attempts to slow credential stuffing / brute force.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many attempts. Please try again later.',
});

const registerValidators = [
  body('username')
    .trim()
    .isLength({ min: 3, max: 30 }).withMessage('Username must be 3-30 characters.')
    .matches(/^[a-zA-Z0-9_]+$/).withMessage('Username may only contain letters, numbers and underscores.'),
  body('email')
    .trim()
    .isEmail().withMessage('Enter a valid email address.')
    .normalizeEmail(),
  body('password')
    .isLength({ min: 8, max: 200 }).withMessage('Password must be at least 8 characters.'),
];

// --- Register -------------------------------------------------------------

router.get('/register', redirectIfAuth, (req, res) => {
  res.render('register', { errors: [], values: {} });
});

router.post('/register', authLimiter, redirectIfAuth, registerValidators, async (req, res, next) => {
  try {
    const errors = validationResult(req);
    const values = { username: req.body.username || '', email: req.body.email || '' };

    if (!errors.isEmpty()) {
      return res.status(400).render('register', { errors: errors.array(), values });
    }

    const { username, email, password } = req.body;

    if (users.byUsername.get(username)) {
      return res.status(400).render('register', {
        errors: [{ msg: 'That username is already taken.' }], values,
      });
    }
    if (users.byEmail.get(email)) {
      return res.status(400).render('register', {
        errors: [{ msg: 'That email is already registered.' }], values,
      });
    }

    // bcrypt: strong, salted, adaptive password hashing.
    const password_hash = await bcrypt.hash(password, 12);
    const info = users.create.run({ username, email, password_hash });

    // Prevent session fixation: establish identity on a fresh session id.
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = info.lastInsertRowid;
      req.session.flash = { type: 'success', message: 'Welcome to Chirp! Your account is ready.' };
      res.redirect('/');
    });
  } catch (err) {
    next(err);
  }
});

// --- Login ----------------------------------------------------------------

router.get('/login', redirectIfAuth, (req, res) => {
  res.render('login', { errors: [], values: {} });
});

router.post('/login', authLimiter, redirectIfAuth, [
  body('username').trim().notEmpty(),
  body('password').notEmpty(),
], async (req, res, next) => {
  try {
    const { username, password } = req.body;
    // Generic message so we don't reveal whether the username exists.
    const fail = () => res.status(401).render('login', {
      errors: [{ msg: 'Invalid username or password.' }],
      values: { username: username || '' },
    });

    if (!username || !password) return fail();

    const user = users.byUsername.get(username);
    if (!user) {
      // Spend time hashing anyway to reduce username-enumeration timing leaks.
      await bcrypt.compare(password, DUMMY_HASH);
      return fail();
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return fail();

    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = user.id;
      res.redirect('/');
    });
  } catch (err) {
    next(err);
  }
});

// --- Logout ---------------------------------------------------------------

router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('sid');
    res.redirect('/login');
  });
});

module.exports = router;
