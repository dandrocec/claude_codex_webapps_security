'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const { rateLimit } = require('express-rate-limit');
const { body, validationResult } = require('express-validator');

const models = require('../models');

const router = express.Router();
const BCRYPT_ROUNDS = 12;

// A valid bcrypt hash compared against when no user is found, so login timing
// is the same whether or not the email exists (resists user enumeration).
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', BCRYPT_ROUNDS);

// Throttle credential endpoints to slow brute-force / enumeration attempts.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many attempts. Please wait a few minutes and try again.',
});

/* ------------------------------ Register ------------------------------- */

router.get('/register', (req, res) => {
  if (req.user) return res.redirect('/dashboard');
  res.render('register', { title: 'Create account', errors: [], values: {} });
});

router.post(
  '/register',
  authLimiter,
  [
    body('name').trim().isLength({ min: 1, max: 80 }).withMessage('Name is required (max 80 chars).'),
    body('email').trim().isEmail().withMessage('A valid email is required.').normalizeEmail(),
    body('password')
      .isLength({ min: 8, max: 200 })
      .withMessage('Password must be at least 8 characters.'),
    body('role').isIn(['instructor', 'student']).withMessage('Choose a valid role.'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      const values = { name: req.body.name, email: req.body.email, role: req.body.role };
      if (!errors.isEmpty()) {
        return res.status(400).render('register', { title: 'Create account', errors: errors.array(), values });
      }

      const { name, email, password, role } = req.body;
      if (models.users.byEmail(email)) {
        return res.status(409).render('register', {
          title: 'Create account',
          errors: [{ msg: 'An account with that email already exists.' }],
          values,
        });
      }

      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      const userId = models.users.create({ name, email, passwordHash, role });

      // Regenerate the session on privilege change to prevent fixation.
      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.userId = userId;
        req.session.flash = { type: 'success', message: 'Welcome! Your account is ready.' };
        res.redirect('/dashboard');
      });
    } catch (err) {
      next(err);
    }
  }
);

/* -------------------------------- Login -------------------------------- */

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/dashboard');
  res.render('login', { title: 'Sign in', errors: [], values: {} });
});

router.post(
  '/login',
  authLimiter,
  [
    body('email').trim().isEmail().withMessage('A valid email is required.').normalizeEmail(),
    body('password').isLength({ min: 1 }).withMessage('Password is required.'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      const values = { email: req.body.email };
      if (!errors.isEmpty()) {
        return res.status(400).render('login', { title: 'Sign in', errors: errors.array(), values });
      }

      const { email, password } = req.body;
      const user = models.users.byEmail(email);

      // Always run a hash comparison to keep timing uniform whether or not
      // the account exists, and return the same generic message either way.
      const hash = user ? user.password_hash : DUMMY_HASH;
      const ok = await bcrypt.compare(password, hash);

      if (!user || !ok) {
        return res.status(401).render('login', {
          title: 'Sign in',
          errors: [{ msg: 'Invalid email or password.' }],
          values,
        });
      }

      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.userId = user.id;
        req.session.flash = { type: 'success', message: `Signed in as ${user.name}.` };
        res.redirect('/dashboard');
      });
    } catch (err) {
      next(err);
    }
  }
);

/* -------------------------------- Logout ------------------------------- */

router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('sid');
    res.redirect('/');
  });
});

module.exports = router;
