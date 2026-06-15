'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');

const db = require('../db');
const { redirectIfAuthed, requireAuth } = require('../security');
const { evaluatePassword } = require('../strength');

const router = express.Router();

const BCRYPT_ROUNDS = 12;

// A valid throwaway hash used to keep login timing uniform when the username
// does not exist (mitigates user enumeration via timing). Computed once.
const DUMMY_HASH = bcrypt.hashSync('unused-placeholder-value', BCRYPT_ROUNDS);

// Input validation + sanitisation for registration (OWASP A03/A04).
const registerValidators = [
  body('username')
    .trim()
    .isLength({ min: 3, max: 32 })
    .withMessage('Username must be 3–32 characters.')
    .matches(/^[a-zA-Z0-9_.-]+$/)
    .withMessage('Username may contain only letters, numbers, _ . and -.')
    .escape(),
  body('password')
    .isString()
    .isLength({ min: 8, max: 200 })
    .withMessage('Password must be at least 8 characters.'),
];

const loginValidators = [
  body('username').trim().notEmpty().withMessage('Username is required.').escape(),
  body('password').isString().notEmpty().withMessage('Password is required.'),
];

router.get('/register', redirectIfAuthed, (req, res) => {
  res.render('register', { errors: [], values: {} });
});

router.post('/register', redirectIfAuthed, registerValidators, async (req, res, next) => {
  try {
    const result = validationResult(req);
    const username = req.body.username;

    if (!result.isEmpty()) {
      return res.status(400).render('register', {
        errors: result.array().map((e) => e.msg),
        values: { username },
      });
    }

    // Reject weak account passwords up front using the same rating engine.
    const strength = evaluatePassword(req.body.password);
    if (strength.rating === 'weak') {
      return res.status(400).render('register', {
        errors: ['Choose a stronger account password: ' + strength.feedback.join(' ')],
        values: { username },
      });
    }

    if (db.findUserByUsername(username)) {
      // Generic-ish message; avoid confirming much beyond uniqueness.
      return res.status(409).render('register', {
        errors: ['That username is not available.'],
        values: { username },
      });
    }

    // Hash with bcrypt: salted + adaptive work factor (OWASP A02/A07).
    const passwordHash = await bcrypt.hash(req.body.password, BCRYPT_ROUNDS);
    const user = db.createUser(username, passwordHash);

    // Prevent session fixation: establish identity on a fresh session.
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = user.id;
      req.session.username = user.username;
      res.redirect('/dashboard');
    });
  } catch (err) {
    next(err);
  }
});

router.get('/login', redirectIfAuthed, (req, res) => {
  res.render('login', { errors: [], values: {} });
});

router.post('/login', redirectIfAuthed, loginValidators, async (req, res, next) => {
  try {
    const result = validationResult(req);
    const username = req.body.username;

    if (!result.isEmpty()) {
      return res.status(400).render('login', {
        errors: result.array().map((e) => e.msg),
        values: { username },
      });
    }

    const user = db.findUserByUsername(username);

    // Always run a bcrypt comparison to keep timing uniform whether or not the
    // user exists, and return one generic error to avoid user enumeration.
    const hash = user ? user.password_hash : DUMMY_HASH;
    const ok = await bcrypt.compare(req.body.password, hash);

    if (!user || !ok) {
      return res.status(401).render('login', {
        errors: ['Invalid username or password.'],
        values: { username },
      });
    }

    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = user.id;
      req.session.username = user.username;
      res.redirect('/dashboard');
    });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', requireAuth, (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('sid');
    res.redirect('/login');
  });
});

module.exports = router;
