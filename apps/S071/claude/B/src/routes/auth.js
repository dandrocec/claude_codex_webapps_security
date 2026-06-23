'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const models = require('../models');

const router = express.Router();

const BCRYPT_ROUNDS = 12;

// A real, parseable bcrypt hash used when the username does not exist, so the
// login path always performs a comparison of equal cost. This keeps response
// timing uniform and avoids username enumeration.
const DUMMY_HASH = bcrypt.hashSync('placeholder-not-a-real-password', BCRYPT_ROUNDS);

// Throttle credential endpoints to slow brute-force / credential stuffing.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many attempts. Please try again later.',
});

const usernameRule = body('username')
  .trim()
  .isLength({ min: 3, max: 32 })
  .withMessage('Username must be 3–32 characters.')
  .matches(/^[A-Za-z0-9_]+$/)
  .withMessage('Username may contain only letters, numbers, and underscores.');

const passwordRule = body('password')
  .isLength({ min: 8, max: 200 })
  .withMessage('Password must be at least 8 characters.');

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

router.get('/register', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('register', { errors: [], values: {} });
});

router.post(
  '/register',
  authLimiter,
  usernameRule,
  passwordRule,
  async (req, res, next) => {
    const result = validationResult(req);
    const values = { username: req.body.username || '' };
    if (!result.isEmpty()) {
      return res
        .status(400)
        .render('register', { errors: result.array(), values });
    }
    try {
      const { username, password } = req.body;
      if (models.getUserByUsername(username)) {
        return res.status(409).render('register', {
          errors: [{ msg: 'That username is already taken.' }],
          values,
        });
      }
      const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      const info = models.createUser(username, hash);
      await regenerateSession(req);
      req.session.userId = info.lastInsertRowid;
      res.redirect('/');
    } catch (err) {
      next(err);
    }
  }
);

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('login', { errors: [], values: {} });
});

router.post(
  '/login',
  authLimiter,
  usernameRule,
  passwordRule,
  async (req, res, next) => {
    const result = validationResult(req);
    const values = { username: req.body.username || '' };
    if (!result.isEmpty()) {
      return res.status(400).render('login', { errors: result.array(), values });
    }
    try {
      const { username, password } = req.body;
      const user = models.getUserByUsername(username);

      // Always run a hash comparison to keep timing consistent and avoid
      // revealing whether the username exists (user enumeration).
      const hash = user ? user.password_hash : DUMMY_HASH;
      const ok = await bcrypt.compare(password, hash);

      if (!user || !ok) {
        return res.status(401).render('login', {
          errors: [{ msg: 'Invalid username or password.' }],
          values,
        });
      }

      await regenerateSession(req);
      req.session.userId = user.id;
      res.redirect('/');
    } catch (err) {
      next(err);
    }
  }
);

router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('sid');
    res.redirect('/login');
  });
});

module.exports = router;
