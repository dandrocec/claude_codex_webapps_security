'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');

const db = require('../db');

const router = express.Router();

const BCRYPT_ROUNDS = 12;

// A real, valid hash used to keep login timing roughly constant when the
// username does not exist (avoids a user-enumeration timing oracle).
const DUMMY_HASH = bcrypt.hashSync('invalid-placeholder-password', BCRYPT_ROUNDS);

// Throttle auth endpoints to slow down credential stuffing / brute force.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
});

const usernameRules = body('username')
  .trim()
  .isLength({ min: 3, max: 32 })
  .withMessage('Username must be 3–32 characters.')
  .matches(/^[a-zA-Z0-9_]+$/)
  .withMessage('Username may contain letters, numbers and underscores only.');

const passwordRules = body('password')
  .isLength({ min: 8, max: 200 })
  .withMessage('Password must be at least 8 characters.');

// --- Registration ---------------------------------------------------------

router.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('register', { errors: [], values: {} });
});

router.post(
  '/register',
  authLimiter,
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
      const existing = db
        .prepare('SELECT id FROM users WHERE username = ?')
        .get(username);
      if (existing) {
        return res.status(409).render('register', {
          errors: ['That username is already taken.'],
          values: { username },
        });
      }

      const hash = bcrypt.hashSync(req.body.password, BCRYPT_ROUNDS);
      const info = db
        .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
        .run(username, hash);

      // Prevent session fixation: regenerate the session on privilege change.
      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.userId = info.lastInsertRowid;
        req.session.username = username;
        res.redirect('/');
      });
    } catch (err) {
      next(err);
    }
  }
);

// --- Login ----------------------------------------------------------------

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('login', { errors: [], values: {} });
});

router.post(
  '/login',
  authLimiter,
  usernameRules,
  passwordRules,
  (req, res, next) => {
    const result = validationResult(req);
    const username = req.body.username;
    if (!result.isEmpty()) {
      // Use a generic message to avoid disclosing which field failed.
      return res.status(400).render('login', {
        errors: ['Invalid username or password.'],
        values: { username },
      });
    }

    try {
      const user = db
        .prepare('SELECT id, username, password_hash FROM users WHERE username = ?')
        .get(username);

      // Always run a hash comparison to keep timing roughly constant whether
      // or not the user exists.
      const ok = user
        ? bcrypt.compareSync(req.body.password, user.password_hash)
        : bcrypt.compareSync(req.body.password, DUMMY_HASH) && false;

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
        res.redirect('/');
      });
    } catch (err) {
      next(err);
    }
  }
);

// --- Logout ---------------------------------------------------------------

router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('connect.sid');
    res.redirect('/login');
  });
});

module.exports = router;
