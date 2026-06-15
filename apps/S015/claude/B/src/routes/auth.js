'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');

const db = require('../db');

const router = express.Router();

// Cost factor for bcrypt. 12 is a sensible modern default (strong + salted).
const BCRYPT_ROUNDS = 12;

// Prepared statements use bound parameters (?) — never string concatenation —
// so user input can never alter the SQL structure (no SQL injection).
const findUserByName = db.prepare('SELECT * FROM users WHERE username = ?');
const insertUser = db.prepare(
  'INSERT INTO users (username, password_hash) VALUES (?, ?)'
);

const credentialRules = [
  body('username')
    .trim()
    .isLength({ min: 3, max: 32 })
    .withMessage('Username must be 3-32 characters.')
    .matches(/^[a-zA-Z0-9_.-]+$/)
    .withMessage('Username may only contain letters, numbers, and . _ -'),
  body('password')
    .isLength({ min: 8, max: 200 })
    .withMessage('Password must be at least 8 characters.'),
];

router.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('register', { title: 'Register', errors: [], values: {} });
});

router.post('/register', credentialRules, async (req, res, next) => {
  const errors = validationResult(req);
  const username = req.body.username;

  if (!errors.isEmpty()) {
    return res.status(400).render('register', {
      title: 'Register',
      errors: errors.array().map((e) => e.msg),
      values: { username },
    });
  }

  try {
    const passwordHash = await bcrypt.hash(req.body.password, BCRYPT_ROUNDS);
    insertUser.run(username, passwordHash);

    return res.redirect('/login?registered=1');
  } catch (err) {
    // UNIQUE constraint violation => username already taken. Return a generic
    // message rather than leaking which usernames exist where possible.
    if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).render('register', {
        title: 'Register',
        errors: ['That username is not available.'],
        values: { username },
      });
    }
    return next(err);
  }
});

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('login', {
    title: 'Login',
    errors: [],
    notice: req.query.registered ? 'Account created. Please log in.' : null,
    values: {},
  });
});

router.post('/login', credentialRules, async (req, res, next) => {
  const errors = validationResult(req);
  const username = req.body.username;

  // Use a single generic error for any auth failure to avoid user enumeration.
  const genericFailure = () =>
    res.status(401).render('login', {
      title: 'Login',
      errors: ['Invalid username or password.'],
      notice: null,
      values: { username },
    });

  if (!errors.isEmpty()) {
    return genericFailure();
  }

  try {
    const user = findUserByName.get(username);

    // Always run a bcrypt comparison (even when the user is missing) so the
    // response time does not reveal whether the username exists.
    const hash = user
      ? user.password_hash
      : '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva';
    const passwordOk = await bcrypt.compare(req.body.password, hash);

    if (!user || !passwordOk) {
      return genericFailure();
    }

    // Prevent session fixation: issue a fresh session on privilege change.
    req.session.regenerate((regenErr) => {
      if (regenErr) return next(regenErr);
      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.save((saveErr) => {
        if (saveErr) return next(saveErr);
        res.redirect('/');
      });
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('sid');
    res.redirect('/login');
  });
});

module.exports = router;
