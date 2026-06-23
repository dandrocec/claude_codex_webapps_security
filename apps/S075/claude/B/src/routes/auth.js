'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');
const { db } = require('../db');

const router = express.Router();

const BCRYPT_ROUNDS = 12;

const getUserByUsername = db.prepare('SELECT * FROM users WHERE username = ?');
const insertUser = db.prepare(
  'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)'
);

// --- Registration -----------------------------------------------------------

router.get('/register', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('register', { title: 'Register', errors: [], values: {} });
});

router.post(
  '/register',
  [
    body('username')
      .trim()
      .isLength({ min: 3, max: 32 })
      .withMessage('Username must be 3–32 characters.')
      .matches(/^[a-zA-Z0-9_.-]+$/)
      .withMessage('Username may contain letters, numbers, and . _ - only.'),
    body('password')
      .isLength({ min: 8, max: 128 })
      .withMessage('Password must be at least 8 characters.'),
    body('role')
      .isIn(['teacher', 'student'])
      .withMessage('Please choose a valid role.'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      const values = { username: req.body.username, role: req.body.role };
      if (!errors.isEmpty()) {
        return res
          .status(400)
          .render('register', { title: 'Register', errors: errors.array(), values });
      }

      const { username, password, role } = req.body;

      if (getUserByUsername.get(username)) {
        return res.status(409).render('register', {
          title: 'Register',
          errors: [{ msg: 'That username is already taken.' }],
          values,
        });
      }

      const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      const info = insertUser.run(username, hash, role);

      // Log the new user in and regenerate the session to prevent fixation.
      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.user = { id: info.lastInsertRowid, username, role };
        res.redirect('/');
      });
    } catch (err) {
      next(err);
    }
  }
);

// --- Login -------------------------------------------------------------------

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { title: 'Log in', errors: [], values: {} });
});

router.post(
  '/login',
  [
    body('username').trim().notEmpty().withMessage('Username is required.'),
    body('password').notEmpty().withMessage('Password is required.'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      const values = { username: req.body.username };
      if (!errors.isEmpty()) {
        return res
          .status(400)
          .render('login', { title: 'Log in', errors: errors.array(), values });
      }

      const { username, password } = req.body;
      const user = getUserByUsername.get(username);

      // Generic error message: do not reveal whether the username exists.
      const invalid = () =>
        res.status(401).render('login', {
          title: 'Log in',
          errors: [{ msg: 'Invalid username or password.' }],
          values,
        });

      if (!user) {
        // Spend roughly the same time as a real bcrypt compare to limit
        // username enumeration via timing.
        await bcrypt.compare(password, '$2b$12$' + 'x'.repeat(53));
        return invalid();
      }

      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) return invalid();

      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.user = { id: user.id, username: user.username, role: user.role };
        res.redirect('/');
      });
    } catch (err) {
      next(err);
    }
  }
);

// --- Logout ------------------------------------------------------------------

router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('sid');
    res.redirect('/login');
  });
});

module.exports = router;
