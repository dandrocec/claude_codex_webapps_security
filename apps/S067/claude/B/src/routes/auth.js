'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');

const { db } = require('../../db');
const { redirectIfAuthed } = require('../middleware/auth');

const router = express.Router();

// Throttle authentication attempts to slow credential stuffing / brute force.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many attempts. Please try again later.'
});

const registerValidators = [
  body('username')
    .trim()
    .isLength({ min: 3, max: 32 })
    .withMessage('Username must be 3-32 characters.')
    .matches(/^[a-zA-Z0-9_.-]+$/)
    .withMessage('Username may contain letters, numbers, and . _ - only.'),
  body('email')
    .trim()
    .isEmail()
    .withMessage('A valid email is required.')
    .normalizeEmail(),
  body('password')
    .isLength({ min: 8, max: 128 })
    .withMessage('Password must be at least 8 characters.')
];

/**
 * Regenerate the session on privilege change to prevent session fixation,
 * then store the minimal user identity.
 */
function establishSession(req, user, done) {
  req.session.regenerate((err) => {
    if (err) return done(err);
    req.session.user = { id: user.id, username: user.username, role: user.role };
    req.session.save(done);
  });
}

router.get('/register', redirectIfAuthed, (req, res) => {
  res.render('register', { title: 'Register', errors: [], values: {} });
});

router.post('/register', authLimiter, redirectIfAuthed, registerValidators, (req, res, next) => {
  const errors = validationResult(req);
  const values = { username: req.body.username, email: req.body.email };

  if (!errors.isEmpty()) {
    return res.status(400).render('register', {
      title: 'Register',
      errors: errors.array().map((e) => e.msg),
      values
    });
  }

  try {
    const { username, email, password } = req.body;

    const exists = db
      .prepare('SELECT id FROM users WHERE username = ? OR email = ?')
      .get(username, email);
    if (exists) {
      return res.status(409).render('register', {
        title: 'Register',
        errors: ['That username or email is already registered.'],
        values
      });
    }

    const hash = bcrypt.hashSync(password, 12);
    const info = db
      .prepare(
        'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)'
      )
      .run(username, email, hash, 'customer');

    const user = { id: info.lastInsertRowid, username, role: 'customer' };
    return establishSession(req, user, (err) => {
      if (err) return next(err);
      res.redirect('/menu');
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/login', redirectIfAuthed, (req, res) => {
  res.render('login', { title: 'Log in', errors: [], values: {} });
});

router.post(
  '/login',
  authLimiter,
  redirectIfAuthed,
  [body('username').trim().notEmpty(), body('password').notEmpty()],
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).render('login', {
        title: 'Log in',
        errors: ['Username and password are required.'],
        values: { username: req.body.username }
      });
    }

    try {
      const { username, password } = req.body;
      const user = db
        .prepare('SELECT * FROM users WHERE username = ?')
        .get(username);

      // Always run a hash comparison to avoid leaking which usernames exist
      // via response timing.
      const hash = user ? user.password_hash : '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali';
      const ok = bcrypt.compareSync(password, hash);

      if (!user || !ok) {
        return res.status(401).render('login', {
          title: 'Log in',
          errors: ['Invalid username or password.'],
          values: { username }
        });
      }

      return establishSession(req, user, (err) => {
        if (err) return next(err);
        res.redirect(user.role === 'staff' ? '/staff/orders' : '/menu');
      });
    } catch (err) {
      return next(err);
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
