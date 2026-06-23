'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');

const db = require('../db');
const { redirectIfAuthenticated } = require('../middleware/auth');

const router = express.Router();

const BCRYPT_ROUNDS = 12;

// Throttle authentication attempts to slow credential-stuffing / brute force.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many attempts. Please wait a few minutes and try again.',
});

const registerValidators = [
  body('email')
    .trim()
    .isEmail().withMessage('Enter a valid email address.')
    .normalizeEmail()
    .isLength({ max: 254 }),
  body('password')
    .isLength({ min: 10, max: 200 })
    .withMessage('Password must be at least 10 characters long.'),
];

// --- Register -------------------------------------------------------------

router.get('/register', redirectIfAuthenticated, (req, res) => {
  res.render('register', { title: 'Register', errors: [], values: {} });
});

router.post('/register', authLimiter, redirectIfAuthenticated, registerValidators, async (req, res, next) => {
  try {
    const errors = validationResult(req);
    const email = (req.body.email || '').trim();

    if (!errors.isEmpty()) {
      return res.status(400).render('register', {
        title: 'Register',
        errors: errors.array().map((e) => e.msg),
        values: { email },
      });
    }

    const passwordHash = await bcrypt.hash(req.body.password, BCRYPT_ROUNDS);

    try {
      const info = db
        .prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)')
        .run(email, passwordHash);

      // Regenerate the session on privilege change to prevent fixation.
      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.userId = info.lastInsertRowid;
        req.session.userEmail = email;
        res.redirect('/events');
      });
    } catch (dbErr) {
      if (dbErr && dbErr.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        // Generic message — do not confirm/deny account existence beyond this.
        return res.status(400).render('register', {
          title: 'Register',
          errors: ['An account with that email may already exist.'],
          values: { email },
        });
      }
      throw dbErr;
    }
  } catch (err) {
    next(err);
  }
});

// --- Login ----------------------------------------------------------------

router.get('/login', redirectIfAuthenticated, (req, res) => {
  res.render('login', { title: 'Log in', errors: [], values: {} });
});

router.post('/login', authLimiter, redirectIfAuthenticated, async (req, res, next) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';

    const user = db
      .prepare('SELECT id, email, password_hash FROM users WHERE email = ?')
      .get(email);

    // Always run a bcrypt comparison to keep timing uniform whether or not
    // the account exists, avoiding user-enumeration via response time.
    const hashToCheck = user
      ? user.password_hash
      : '$2b$12$0000000000000000000000000000000000000000000000000000a';
    const ok = await bcrypt.compare(password, hashToCheck);

    if (!user || !ok) {
      return res.status(401).render('login', {
        title: 'Log in',
        errors: ['Invalid email or password.'],
        values: { email },
      });
    }

    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = user.id;
      req.session.userEmail = user.email;
      res.redirect('/events');
    });
  } catch (err) {
    next(err);
  }
});

// --- Logout ---------------------------------------------------------------

router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('sid');
    res.redirect('/login');
  });
});

module.exports = router;
