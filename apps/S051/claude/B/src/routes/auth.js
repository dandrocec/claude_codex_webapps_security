'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');

const db = require('../db');
const { redirectIfAuth } = require('../middleware/auth');

const router = express.Router();

const BCRYPT_ROUNDS = 12;

// A real, valid bcrypt hash generated once at startup. Used to run a comparison
// even when the username is unknown, so login timing doesn't reveal whether an
// account exists (user enumeration mitigation).
const DUMMY_HASH = bcrypt.hashSync('unused-placeholder-value', BCRYPT_ROUNDS);

// Prepared statements (parameterised — no string concatenation).
const findUserByName = db.prepare('SELECT * FROM users WHERE username = ?');
const insertUser = db.prepare(
  'INSERT INTO users (username, password_hash) VALUES (?, ?)'
);

const usernameRules = body('username')
  .trim()
  .isLength({ min: 3, max: 32 })
  .withMessage('Username must be 3-32 characters.')
  .matches(/^[a-zA-Z0-9_]+$/)
  .withMessage('Username may only contain letters, numbers and underscores.');

const passwordRules = body('password')
  .isLength({ min: 8, max: 128 })
  .withMessage('Password must be at least 8 characters.');

// ---- Registration ----------------------------------------------------------

router.get('/register', redirectIfAuth, (req, res) => {
  res.render('register', { errors: [], values: {} });
});

router.post(
  '/register',
  redirectIfAuth,
  usernameRules,
  passwordRules,
  (req, res, next) => {
    const result = validationResult(req);
    const username = req.body.username;

    if (!result.isEmpty()) {
      return res.status(400).render('register', {
        errors: result.array().map((e) => e.msg),
        values: { username },
      });
    }

    try {
      if (findUserByName.get(username)) {
        return res.status(409).render('register', {
          errors: ['That username is already taken.'],
          values: { username },
        });
      }

      const hash = bcrypt.hashSync(req.body.password, BCRYPT_ROUNDS);
      const info = insertUser.run(username, hash);

      // Prevent session fixation: establish a fresh session on login.
      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.userId = info.lastInsertRowid;
        req.session.username = username;
        res.redirect('/movies');
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---- Login -----------------------------------------------------------------

router.get('/login', redirectIfAuth, (req, res) => {
  res.render('login', { errors: [], values: {} });
});

router.post('/login', redirectIfAuth, (req, res, next) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';

  try {
    const user = findUserByName.get(username);

    // Always run a hash comparison to keep timing roughly constant whether or
    // not the user exists, and return a single generic error either way.
    const hash = user ? user.password_hash : DUMMY_HASH;
    const ok = bcrypt.compareSync(password, hash);

    if (!user || !ok) {
      return res.status(401).render('login', {
        errors: ['Invalid username or password.'],
        values: { username },
      });
    }

    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = user.id;
      req.session.username = user.username;
      res.redirect('/movies');
    });
  } catch (err) {
    next(err);
  }
});

// ---- Logout ----------------------------------------------------------------

router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('sid');
    res.redirect('/login');
  });
});

module.exports = router;
