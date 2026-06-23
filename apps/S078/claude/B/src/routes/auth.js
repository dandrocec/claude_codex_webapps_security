'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');

const { Users } = require('../models');

const router = express.Router();

const BCRYPT_ROUNDS = 12;

// A valid throwaway hash compared against when no user is found, so login
// timing does not reveal whether an email exists.
const DUMMY_HASH = bcrypt.hashSync('account-does-not-exist', BCRYPT_ROUNDS);

// Throttle authentication attempts to blunt credential-stuffing / brute force.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many attempts. Please wait a few minutes and try again.',
});

// If already logged in, skip auth pages.
function redirectIfAuthed(req, res, next) {
  if (req.user) return res.redirect('/');
  next();
}

// ----- Register ------------------------------------------------------------
router.get('/register', redirectIfAuthed, (req, res) => {
  res.render('register', { title: 'Register', errors: [], values: {} });
});

router.post(
  '/register',
  authLimiter,
  redirectIfAuthed,
  [
    body('name').trim().notEmpty().withMessage('Name is required.').isLength({ max: 100 }),
    body('email').trim().isEmail().withMessage('A valid email is required.')
      .normalizeEmail().isLength({ max: 200 }),
    body('password').isLength({ min: 10, max: 200 })
      .withMessage('Password must be at least 10 characters.'),
    body('role').optional().isIn(['sales', 'manager']),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    const values = { name: req.body.name, email: req.body.email, role: req.body.role };
    if (!errors.isEmpty()) {
      return res.status(400).render('register', {
        title: 'Register',
        errors: errors.array(),
        values,
      });
    }

    try {
      const existing = Users.byEmail(req.body.email);
      if (existing) {
        return res.status(400).render('register', {
          title: 'Register',
          errors: [{ msg: 'An account with that email already exists.' }],
          values,
        });
      }

      const passwordHash = await bcrypt.hash(req.body.password, BCRYPT_ROUNDS);
      const role = req.body.role === 'manager' ? 'manager' : 'sales';
      const result = Users.add({
        name: req.body.name,
        email: req.body.email,
        password_hash: passwordHash,
        role,
      });

      // Regenerate the session on privilege change to prevent fixation.
      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.userId = result.lastInsertRowid;
        res.redirect('/');
      });
    } catch (err) {
      next(err);
    }
  }
);

// ----- Login ---------------------------------------------------------------
router.get('/login', redirectIfAuthed, (req, res) => {
  res.render('login', { title: 'Log in', errors: [], values: {} });
});

router.post(
  '/login',
  authLimiter,
  redirectIfAuthed,
  [
    body('email').trim().isEmail().normalizeEmail(),
    body('password').notEmpty(),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).render('login', {
        title: 'Log in',
        errors: [{ msg: 'Please enter a valid email and password.' }],
        values: { email: req.body.email },
      });
    }

    try {
      const user = Users.byEmail(req.body.email);

      // Always run a hash comparison to avoid leaking which emails exist
      // through response timing.
      const hash = user ? user.password_hash : DUMMY_HASH;
      const ok = await bcrypt.compare(req.body.password, hash);

      if (!user || !ok) {
        return res.status(401).render('login', {
          title: 'Log in',
          errors: [{ msg: 'Invalid email or password.' }],
          values: { email: req.body.email },
        });
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

// ----- Logout --------------------------------------------------------------
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('crm.sid');
    res.redirect('/login');
  });
});

module.exports = router;
