'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');

const users = require('../models/users');
const { redirectIfAuthed } = require('../middleware/auth');

const router = express.Router();

const BCRYPT_ROUNDS = 12;

const usernameRules = body('username')
  .trim()
  .isLength({ min: 3, max: 32 })
  .withMessage('Username must be 3–32 characters.')
  .matches(/^[a-zA-Z0-9_.-]+$/)
  .withMessage('Username may contain only letters, numbers, and . _ -');

const passwordRules = body('password')
  .isLength({ min: 8, max: 128 })
  .withMessage('Password must be at least 8 characters.');

// ---- Register ----------------------------------------------------------------

router.get('/register', redirectIfAuthed, (req, res) => {
  res.render('register', { errors: [], values: {} });
});

router.post(
  '/register',
  redirectIfAuthed,
  usernameRules,
  passwordRules,
  async (req, res, next) => {
    const result = validationResult(req);
    const values = { username: req.body.username };

    if (!result.isEmpty()) {
      return res
        .status(400)
        .render('register', { errors: result.array(), values });
    }

    try {
      const existing = users.findByUsername(req.body.username);
      if (existing) {
        return res.status(409).render('register', {
          errors: [{ msg: 'That username is already taken.' }],
          values,
        });
      }

      const hash = await bcrypt.hash(req.body.password, BCRYPT_ROUNDS);
      const userId = users.create(req.body.username, hash);

      // Prevent session fixation: establish a fresh session on auth.
      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.userId = userId;
        res.redirect('/');
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---- Login -------------------------------------------------------------------

router.get('/login', redirectIfAuthed, (req, res) => {
  res.render('login', { errors: [], values: {} });
});

router.post(
  '/login',
  redirectIfAuthed,
  body('username').trim().notEmpty(),
  body('password').notEmpty(),
  async (req, res, next) => {
    const result = validationResult(req);
    const values = { username: req.body.username };

    // Generic message for any failure to avoid user enumeration.
    const fail = () =>
      res
        .status(401)
        .render('login', { errors: [{ msg: 'Invalid username or password.' }], values });

    if (!result.isEmpty()) {
      return fail();
    }

    try {
      const user = users.findByUsername(req.body.username);
      // Always run a bcrypt comparison to keep timing roughly constant even
      // when the user does not exist.
      const hash = user
        ? user.password_hash
        : '$2b$12$0000000000000000000000000000000000000000000000000000z';
      const ok = await bcrypt.compare(req.body.password, hash);

      if (!user || !ok) {
        return fail();
      }

      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.userId = user.id;
        res.redirect('/');
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---- Logout ------------------------------------------------------------------

router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('sid');
    res.redirect('/login');
  });
});

module.exports = router;
