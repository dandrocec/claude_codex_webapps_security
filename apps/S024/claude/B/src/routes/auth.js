'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');

const db = require('../db');
const config = require('../config');
const { verifyToken } = require('../csrf');
const { requireGuest, requireAuth } = require('../auth');

const router = express.Router();

// Throttle credential endpoints to slow down brute-force / credential stuffing.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many attempts. Please wait a few minutes and try again.',
});

const usernameRule = body('username')
  .trim()
  .isLength({ min: 3, max: 32 })
  .withMessage('Username must be 3-32 characters.')
  .matches(/^[a-zA-Z0-9_]+$/)
  .withMessage('Username may only contain letters, numbers and underscores.');

const passwordRule = body('password')
  .isLength({ min: 8, max: 200 })
  .withMessage('Password must be at least 8 characters.');

// A valid bcrypt hash compared against when a username doesn't exist, so login
// takes roughly constant time whether or not the account is real (mitigates
// username enumeration via timing). Generated once at startup.
const DUMMY_HASH = bcrypt.hashSync('account-does-not-exist', config.bcryptRounds);

// Prepared statements (parameterised — no string concatenation -> no SQLi).
const findUserByName = db.prepare('SELECT * FROM users WHERE username = ?');
const insertUser = db.prepare(
  'INSERT INTO users (username, password_hash) VALUES (?, ?)'
);

router.get('/register', requireGuest, (req, res) => {
  res.render('register', { errors: [], values: {} });
});

router.post(
  '/register',
  requireGuest,
  authLimiter,
  verifyToken,
  usernameRule,
  passwordRule,
  (req, res, next) => {
    const errors = validationResult(req);
    const values = { username: req.body.username };

    if (!errors.isEmpty()) {
      return res
        .status(400)
        .render('register', { errors: errors.array(), values });
    }

    try {
      if (findUserByName.get(req.body.username)) {
        return res.status(409).render('register', {
          errors: [{ msg: 'That username is already taken.' }],
          values,
        });
      }

      const hash = bcrypt.hashSync(req.body.password, config.bcryptRounds);
      const info = insertUser.run(req.body.username, hash);

      // Prevent session fixation: establish a fresh session on privilege change.
      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.userId = info.lastInsertRowid;
        req.session.username = req.body.username;
        res.redirect('/dashboard');
      });
    } catch (err) {
      next(err);
    }
  }
);

router.get('/login', requireGuest, (req, res) => {
  res.render('login', { errors: [], values: {} });
});

router.post(
  '/login',
  requireGuest,
  authLimiter,
  verifyToken,
  usernameRule,
  passwordRule,
  (req, res, next) => {
    const errors = validationResult(req);
    const values = { username: req.body.username };

    if (!errors.isEmpty()) {
      return res.status(400).render('login', { errors: errors.array(), values });
    }

    try {
      const user = findUserByName.get(req.body.username);

      // Always run a hash comparison to avoid leaking which usernames exist via
      // timing differences. Use a generic message for any failure.
      const ok = bcrypt.compareSync(
        req.body.password,
        user ? user.password_hash : DUMMY_HASH
      );

      if (!user || !ok) {
        return res.status(401).render('login', {
          errors: [{ msg: 'Invalid username or password.' }],
          values,
        });
      }

      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.userId = user.id;
        req.session.username = user.username;
        res.redirect('/dashboard');
      });
    } catch (err) {
      next(err);
    }
  }
);

router.post('/logout', requireAuth, verifyToken, (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('sid');
    res.redirect('/login');
  });
});

module.exports = router;
