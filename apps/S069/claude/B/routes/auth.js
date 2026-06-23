'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');

const db = require('../db');

const router = express.Router();

const BCRYPT_ROUNDS = 12;

// Limit authentication attempts to slow credential-stuffing / brute force.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many attempts. Please try again later.',
});

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    const prev = req.session;
    req.session.regenerate((err) => {
      if (err) return reject(err);
      // Preserve nothing sensitive; a fresh session prevents fixation.
      resolve(prev);
    });
  });
}

// ---- Registration ----------------------------------------------------------

router.get('/register', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('register', { errors: [], values: {} });
});

router.post(
  '/register',
  authLimiter,
  body('email').trim().isEmail().normalizeEmail().withMessage('A valid email is required.'),
  body('display_name')
    .trim()
    .isLength({ min: 1, max: 80 })
    .withMessage('Display name must be 1–80 characters.'),
  body('password')
    .isLength({ min: 10, max: 200 })
    .withMessage('Password must be at least 10 characters.'),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      const values = { email: req.body.email, display_name: req.body.display_name };
      if (!errors.isEmpty()) {
        return res.status(400).render('register', { errors: errors.array(), values });
      }

      const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(req.body.email);
      if (existing) {
        return res.status(400).render('register', {
          errors: [{ msg: 'That email is already registered.' }],
          values,
        });
      }

      const hash = await bcrypt.hash(req.body.password, BCRYPT_ROUNDS);
      const result = db
        .prepare('INSERT INTO users (email, display_name, password_hash) VALUES (?, ?, ?)')
        .run(req.body.email, req.body.display_name, hash);

      await regenerateSession(req);
      req.session.userId = result.lastInsertRowid;
      res.redirect('/');
    } catch (err) {
      next(err);
    }
  }
);

// ---- Login -----------------------------------------------------------------

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('login', { errors: [], values: {} });
});

router.post(
  '/login',
  authLimiter,
  body('email').trim().isEmail().normalizeEmail(),
  body('password').isLength({ min: 1 }),
  async (req, res, next) => {
    try {
      const values = { email: req.body.email };
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res
          .status(400)
          .render('login', { errors: [{ msg: 'Invalid email or password.' }], values });
      }

      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(req.body.email);

      // Always run a hash comparison to keep timing uniform whether or not the
      // user exists, and never reveal which field was wrong.
      const hash = user ? user.password_hash : '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinv';
      const ok = await bcrypt.compare(req.body.password, hash);

      if (!user || !ok) {
        return res
          .status(401)
          .render('login', { errors: [{ msg: 'Invalid email or password.' }], values });
      }

      await regenerateSession(req);
      req.session.userId = user.id;
      res.redirect('/');
    } catch (err) {
      next(err);
    }
  }
);

// ---- Logout ----------------------------------------------------------------

router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('sid');
    res.redirect('/');
  });
});

module.exports = router;
