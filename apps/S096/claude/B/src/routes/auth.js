'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const users = require('../services/users');
const { requireGuest } = require('../middleware/auth');

const router = express.Router();

// Throttle authentication attempts to slow down credential stuffing / brute force.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
});

const emailRule = body('email')
  .trim()
  .isEmail()
  .withMessage('Enter a valid email address.')
  .normalizeEmail()
  .isLength({ max: 254 });

const passwordRule = body('password')
  .isString()
  .isLength({ min: 10, max: 200 })
  .withMessage('Password must be at least 10 characters long.');

function collectErrors(req) {
  return validationResult(req)
    .array()
    .map((e) => e.msg);
}

// --- Register ---
router.get('/register', requireGuest, (req, res) => {
  res.render('register', { title: 'Register', errors: [], values: {} });
});

router.post(
  '/register',
  requireGuest,
  authLimiter,
  emailRule,
  passwordRule,
  body('confirm').custom((value, { req }) => {
    if (value !== req.body.password) throw new Error('Passwords do not match.');
    return true;
  }),
  async (req, res, next) => {
    try {
      const errors = collectErrors(req);
      const email = req.body.email;
      if (errors.length) {
        return res.status(400).render('register', {
          title: 'Register',
          errors,
          values: { email },
        });
      }
      if (users.emailExists(email)) {
        return res.status(400).render('register', {
          title: 'Register',
          errors: ['An account with that email already exists.'],
          values: { email },
        });
      }
      const user = await users.createUser(email, req.body.password);
      // Prevent session fixation: establish a fresh session on auth.
      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.userId = user.id;
        res.redirect('/dashboard');
      });
    } catch (err) {
      next(err);
    }
  }
);

// --- Login ---
router.get('/login', requireGuest, (req, res) => {
  res.render('login', { title: 'Log in', errors: [], values: {} });
});

router.post(
  '/login',
  requireGuest,
  authLimiter,
  emailRule,
  body('password').isString().notEmpty(),
  async (req, res, next) => {
    try {
      const email = req.body.email;
      const validation = collectErrors(req);
      if (validation.length) {
        return res.status(400).render('login', {
          title: 'Log in',
          errors: ['Invalid email or password.'],
          values: { email },
        });
      }
      const user = users.findByEmail(email);
      const ok = await users.verifyPassword(user, req.body.password);
      if (!ok) {
        // Generic message — do not reveal whether the email exists.
        return res.status(401).render('login', {
          title: 'Log in',
          errors: ['Invalid email or password.'],
          values: { email },
        });
      }
      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.userId = user.id;
        res.redirect('/dashboard');
      });
    } catch (err) {
      next(err);
    }
  }
);

// --- Logout ---
router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('sid');
    res.redirect('/login');
  });
});

module.exports = router;
