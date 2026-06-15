'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');

const { createUser, findUserByUsername } = require('../models');

const router = express.Router();

const BCRYPT_ROUNDS = 12;

// Redirect already-authenticated users away from auth pages.
function redirectIfAuthed(req, res, next) {
  if (req.user) return res.redirect('/bookmarks');
  next();
}

const usernameRules = body('username')
  .trim()
  .isLength({ min: 3, max: 32 })
  .withMessage('Username must be 3–32 characters.')
  .matches(/^[a-zA-Z0-9_]+$/)
  .withMessage('Username may only contain letters, numbers and underscores.');

const passwordRules = body('password')
  .isLength({ min: 8, max: 200 })
  .withMessage('Password must be at least 8 characters.');

// ---- Register -------------------------------------------------------------

router.get('/register', redirectIfAuthed, (req, res) => {
  res.render('register', { errors: [], values: {} });
});

router.post(
  '/register',
  redirectIfAuthed,
  usernameRules,
  passwordRules,
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      const username = req.body.username.trim();

      if (!errors.isEmpty()) {
        return res.status(400).render('register', {
          errors: errors.array().map((e) => e.msg),
          values: { username },
        });
      }

      if (findUserByUsername(username)) {
        return res.status(409).render('register', {
          errors: ['That username is already taken.'],
          values: { username },
        });
      }

      const passwordHash = await bcrypt.hash(req.body.password, BCRYPT_ROUNDS);
      const userId = createUser(username, passwordHash);

      // Prevent session fixation: establish a fresh session on login.
      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.userId = userId;
        res.redirect('/bookmarks');
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---- Login ----------------------------------------------------------------

router.get('/login', redirectIfAuthed, (req, res) => {
  res.render('login', { errors: [], values: {} });
});

router.post(
  '/login',
  redirectIfAuthed,
  body('username').trim().notEmpty(),
  body('password').notEmpty(),
  async (req, res, next) => {
    try {
      const username = req.body.username.trim();
      const password = req.body.password;

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).render('login', {
          errors: ['Please enter your username and password.'],
          values: { username },
        });
      }

      const user = findUserByUsername(username);

      // Always run a hash comparison to reduce username-enumeration timing.
      const hash = user
        ? user.password_hash
        : '$2b$12$............................................................';
      const ok = await bcrypt.compare(password, hash);

      if (!user || !ok) {
        return res.status(401).render('login', {
          errors: ['Invalid username or password.'],
          values: { username },
        });
      }

      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.userId = user.id;
        res.redirect('/bookmarks');
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---- Logout ---------------------------------------------------------------

router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('sid');
    res.redirect('/login');
  });
});

module.exports = router;
