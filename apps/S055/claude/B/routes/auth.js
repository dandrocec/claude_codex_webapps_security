'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');

const db = require('../db');

const router = express.Router();

const BCRYPT_ROUNDS = 12;

// Stricter limit on auth endpoints to slow credential-stuffing / brute force.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many attempts. Please wait a few minutes and try again.',
});

const usernameValidator = body('username')
  .trim()
  .isLength({ min: 3, max: 32 })
  .withMessage('Username must be 3-32 characters.')
  .matches(/^[a-zA-Z0-9_.-]+$/)
  .withMessage('Username may only contain letters, numbers, and _ . -');

const passwordValidator = body('password')
  .isLength({ min: 8, max: 128 })
  .withMessage('Password must be at least 8 characters.');

// --- Register --------------------------------------------------------------
router.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/surveys');
  res.render('register', { title: 'Register', errors: [], values: {} });
});

router.post(
  '/register',
  authLimiter,
  usernameValidator,
  passwordValidator,
  (req, res) => {
    const errors = validationResult(req);
    const username = req.body.username.trim();

    if (!errors.isEmpty()) {
      return res.status(400).render('register', {
        title: 'Register',
        errors: errors.array().map((e) => e.msg),
        values: { username },
      });
    }

    const exists = db
      .prepare('SELECT 1 FROM users WHERE username = ?')
      .get(username);
    if (exists) {
      return res.status(409).render('register', {
        title: 'Register',
        errors: ['That username is already taken.'],
        values: { username },
      });
    }

    const hash = bcrypt.hashSync(req.body.password, BCRYPT_ROUNDS);
    const result = db
      .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
      .run(username, hash);

    // Regenerate session to prevent session fixation.
    req.session.regenerate((err) => {
      if (err) {
        console.error(err);
        return res.status(500).render('error', {
          title: 'Something went wrong',
          message: 'Could not complete registration. Please try again.',
        });
      }
      req.session.userId = result.lastInsertRowid;
      req.session.username = username;
      res.redirect('/surveys');
    });
  }
);

// --- Login -----------------------------------------------------------------
router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/surveys');
  res.render('login', { title: 'Login', errors: [], values: {} });
});

router.post('/login', authLimiter, usernameValidator, passwordValidator, (req, res) => {
  const username = req.body.username.trim();
  const errors = validationResult(req);

  // Generic message to avoid leaking which field/credential was wrong.
  const fail = () =>
    res.status(401).render('login', {
      title: 'Login',
      errors: ['Invalid username or password.'],
      values: { username },
    });

  if (!errors.isEmpty()) return fail();

  const user = db
    .prepare('SELECT id, username, password_hash FROM users WHERE username = ?')
    .get(username);

  // Always run a hash comparison to reduce username-enumeration timing signal.
  const hash = user
    ? user.password_hash
    : '$2b$12$0000000000000000000000000000000000000000000000000000a';
  const match = bcrypt.compareSync(req.body.password, hash);

  if (!user || !match) return fail();

  req.session.regenerate((err) => {
    if (err) {
      console.error(err);
      return res.status(500).render('error', {
        title: 'Something went wrong',
        message: 'Could not complete login. Please try again.',
      });
    }
    req.session.userId = user.id;
    req.session.username = user.username;
    res.redirect('/surveys');
  });
});

// --- Logout ----------------------------------------------------------------
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('sid');
    res.redirect('/login');
  });
});

module.exports = router;
