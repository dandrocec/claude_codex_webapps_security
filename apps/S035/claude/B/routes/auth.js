'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');

const models = require('../models');
const { redirectIfAuthed } = require('../middleware/security');

const router = express.Router();

const BCRYPT_ROUNDS = 12;

// --- Validation rules ---
const usernameRules = body('username')
  .trim()
  .isLength({ min: 3, max: 30 })
  .withMessage('Username must be 3-30 characters.')
  .matches(/^[A-Za-z0-9_.-]+$/)
  .withMessage('Username may contain only letters, numbers, _ . and -');

const passwordRules = body('password')
  .isLength({ min: 8, max: 200 })
  .withMessage('Password must be at least 8 characters.');

// ---------------- Register ----------------
router.get('/register', redirectIfAuthed, (req, res) => {
  res.render('register', { title: 'Register', errors: [], values: {} });
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
          title: 'Register',
          errors: errors.array().map((e) => e.msg),
          values: { username },
        });
      }

      if (models.getUserByUsername(username)) {
        return res.status(409).render('register', {
          title: 'Register',
          errors: ['That username is already taken.'],
          values: { username },
        });
      }

      const passwordHash = await bcrypt.hash(req.body.password, BCRYPT_ROUNDS);
      const userId = models.createUser(username, passwordHash);

      // Prevent session fixation: establish a fresh session on auth change.
      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.userId = userId;
        req.session.username = username;
        res.redirect('/');
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------- Login ----------------
router.get('/login', redirectIfAuthed, (req, res) => {
  res.render('login', { title: 'Log in', errors: [], values: {} });
});

router.post(
  '/login',
  redirectIfAuthed,
  usernameRules,
  passwordRules,
  async (req, res, next) => {
    try {
      const username = req.body.username.trim();
      const errors = validationResult(req);

      // Use one generic message for any failure to avoid user enumeration.
      const genericFail = () =>
        res.status(401).render('login', {
          title: 'Log in',
          errors: ['Invalid username or password.'],
          values: { username },
        });

      if (!errors.isEmpty()) return genericFail();

      const user = models.getUserByUsername(username);
      if (!user) {
        // Spend time comparing against a dummy hash to equalise timing.
        await bcrypt.compare(req.body.password, '$2b$12$' + 'x'.repeat(53));
        return genericFail();
      }

      const ok = await bcrypt.compare(req.body.password, user.password_hash);
      if (!ok) return genericFail();

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

// ---------------- Logout ----------------
router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('sid');
    res.redirect('/login');
  });
});

module.exports = router;
