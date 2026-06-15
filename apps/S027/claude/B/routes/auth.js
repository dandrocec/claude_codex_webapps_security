'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');

const db = require('../db');
const { verifyCsrf } = require('../middleware/auth');

const router = express.Router();

const BCRYPT_ROUNDS = 12;

// Prepared statements (parameterised — no string concatenation).
const findUserByName = db.prepare('SELECT * FROM users WHERE username = ?');
const insertUser = db.prepare(
  'INSERT INTO users (username, password_hash) VALUES (?, ?)'
);

// --- Validation chains -----------------------------------------------------

const usernameRules = body('username')
  .trim()
  .isLength({ min: 3, max: 32 })
  .withMessage('Username must be 3-32 characters.')
  .matches(/^[a-zA-Z0-9_.-]+$/)
  .withMessage('Username may only contain letters, numbers, and _ . -');

const passwordRules = body('password')
  .isLength({ min: 8, max: 128 })
  .withMessage('Password must be at least 8 characters.');

// --- Registration ----------------------------------------------------------

router.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/tasks');
  res.render('register', { errors: [], values: {} });
});

router.post(
  '/register',
  verifyCsrf,
  usernameRules,
  passwordRules,
  (req, res) => {
    const errors = validationResult(req);
    const username = req.body.username.trim();

    if (!errors.isEmpty()) {
      return res.status(400).render('register', {
        errors: errors.array(),
        values: { username },
      });
    }

    try {
      const existing = findUserByName.get(username);
      if (existing) {
        return res.status(409).render('register', {
          errors: [{ msg: 'That username is already taken.' }],
          values: { username },
        });
      }

      const hash = bcrypt.hashSync(req.body.password, BCRYPT_ROUNDS);
      const result = insertUser.run(username, hash);

      // Regenerate the session to prevent session fixation.
      req.session.regenerate((err) => {
        if (err) {
          return res.status(500).render('error', {
            statusCode: 500,
            message: 'Could not complete registration.',
          });
        }
        req.session.userId = result.lastInsertRowid;
        req.session.username = username;
        res.redirect('/tasks');
      });
    } catch (err) {
      return res.status(500).render('error', {
        statusCode: 500,
        message: 'Could not complete registration.',
      });
    }
  }
);

// --- Login -----------------------------------------------------------------

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/tasks');
  res.render('login', { errors: [], values: {} });
});

router.post('/login', verifyCsrf, usernameRules, passwordRules, (req, res) => {
  const errors = validationResult(req);
  const username = req.body.username.trim();

  // Generic message to avoid user enumeration.
  const genericFail = () =>
    res.status(401).render('login', {
      errors: [{ msg: 'Invalid username or password.' }],
      values: { username },
    });

  if (!errors.isEmpty()) return genericFail();

  const user = findUserByName.get(username);

  // Always run a compare to keep timing roughly constant even if user is absent.
  const hash = user
    ? user.password_hash
    : '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
  const ok = bcrypt.compareSync(req.body.password, hash);

  if (!user || !ok) return genericFail();

  req.session.regenerate((err) => {
    if (err) {
      return res.status(500).render('error', {
        statusCode: 500,
        message: 'Could not log you in.',
      });
    }
    req.session.userId = user.id;
    req.session.username = user.username;
    res.redirect('/tasks');
  });
});

// --- Logout ----------------------------------------------------------------

router.post('/logout', verifyCsrf, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('sid');
    res.redirect('/login');
  });
});

module.exports = router;
