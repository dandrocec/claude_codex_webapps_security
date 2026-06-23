'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { rateLimit } = require('express-rate-limit');

const db = require('../db');

const router = express.Router();

// Throttle credential endpoints to slow down brute-force / credential-stuffing.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many attempts. Please wait a few minutes and try again.',
});

const usernameRules = body('username')
  .trim()
  .isLength({ min: 3, max: 32 })
  .withMessage('Username must be 3–32 characters.')
  .matches(/^[a-zA-Z0-9_.-]+$/)
  .withMessage('Username may only contain letters, numbers, and . _ -');

// Password policy: long enough to be meaningful; capped to avoid bcrypt's
// 72-byte truncation surprise.
const passwordRules = body('password')
  .isLength({ min: 8, max: 72 })
  .withMessage('Password must be 8–72 characters.');

// --- Registration -----------------------------------------------------------
router.get('/register', (req, res) => {
  res.render('register', { title: 'Register', formData: {} });
});

router.post(
  '/register',
  authLimiter,
  usernameRules,
  passwordRules,
  (req, res, next) => {
    const errors = validationResult(req);
    const { username } = req.body;

    if (!errors.isEmpty()) {
      return res.status(400).render('register', {
        title: 'Register',
        formErrors: errors.array(),
        formData: { username },
      });
    }

    try {
      const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
      if (existing) {
        return res.status(409).render('register', {
          title: 'Register',
          formErrors: [{ msg: 'That username is already taken.' }],
          formData: { username },
        });
      }

      const passwordHash = bcrypt.hashSync(req.body.password, 12);
      const result = db
        .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
        .run(username, passwordHash);

      // Log the new user in immediately, regenerating the session to prevent
      // session fixation.
      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.userId = Number(result.lastInsertRowid);
        req.session.username = username;
        req.flash('success', `Welcome, ${username}! Your account was created.`);
        res.redirect('/');
      });
    } catch (err) {
      next(err);
    }
  },
);

// --- Login ------------------------------------------------------------------
router.get('/login', (req, res) => {
  res.render('login', { title: 'Log in', formData: {} });
});

router.post(
  '/login',
  authLimiter,
  body('username').trim().notEmpty(),
  body('password').notEmpty(),
  (req, res, next) => {
    const { username } = req.body;
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).render('login', {
        title: 'Log in',
        formErrors: [{ msg: 'Please enter your username and password.' }],
        formData: { username },
      });
    }

    try {
      const user = db
        .prepare('SELECT id, username, password_hash FROM users WHERE username = ?')
        .get(username);

      // Always run a hash comparison to keep timing roughly constant whether or
      // not the username exists, and use a single generic error message so we
      // do not reveal which field was wrong (user enumeration). The fallback is
      // a valid (well-formed) bcrypt hash of a random value so compareSync
      // returns false instead of throwing.
      const fallbackHash = '$2a$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW';
      const ok = bcrypt.compareSync(req.body.password, user ? user.password_hash : fallbackHash);

      if (!user || !ok) {
        return res.status(401).render('login', {
          title: 'Log in',
          formErrors: [{ msg: 'Invalid username or password.' }],
          formData: { username },
        });
      }

      const returnTo = req.session.returnTo;
      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.userId = user.id;
        req.session.username = user.username;
        req.flash('success', `Welcome back, ${user.username}!`);
        res.redirect(returnTo && returnTo.startsWith('/') ? returnTo : '/');
      });
    } catch (err) {
      next(err);
    }
  },
);

// --- Logout -----------------------------------------------------------------
router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('sid');
    res.redirect('/login');
  });
});

module.exports = router;
