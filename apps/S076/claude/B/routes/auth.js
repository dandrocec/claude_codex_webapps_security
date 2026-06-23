'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');

const models = require('../models');

const router = express.Router();

// Input validation rules shared by register.
const credentialRules = [
  body('username')
    .trim()
    .isLength({ min: 3, max: 32 })
    .withMessage('Username must be 3-32 characters.')
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('Username may contain only letters, numbers and underscores.'),
  body('password')
    .isLength({ min: 8, max: 200 })
    .withMessage('Password must be at least 8 characters.'),
];

function firstError(req) {
  const errors = validationResult(req);
  return errors.isEmpty() ? null : errors.array()[0].msg;
}

// ----- Register -----
router.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/rooms');
  res.render('register', { title: 'Register', error: null, values: {} });
});

router.post('/register', credentialRules, async (req, res, next) => {
  try {
    const error = firstError(req);
    const username = (req.body.username || '').trim();
    if (error) {
      return res.status(400).render('register', {
        title: 'Register',
        error,
        values: { username },
      });
    }

    if (models.findUserByName(username)) {
      return res.status(409).render('register', {
        title: 'Register',
        error: 'That username is already taken.',
        values: { username },
      });
    }

    // Strong, salted password hashing with bcrypt (cost factor 12).
    const passwordHash = await bcrypt.hash(req.body.password, 12);
    const user = models.createUser(username, passwordHash);

    // Prevent session fixation: regenerate the session on privilege change.
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = user.id;
      req.session.username = user.username;
      res.redirect('/rooms');
    });
  } catch (err) {
    next(err);
  }
});

// ----- Login -----
router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/rooms');
  res.render('login', { title: 'Login', error: null, values: {} });
});

router.post('/login', credentialRules, async (req, res, next) => {
  try {
    const username = (req.body.username || '').trim();
    const genericError = 'Invalid username or password.';

    // Note: we deliberately return a generic error and still run a hash
    // comparison to avoid user-enumeration / timing side channels.
    const user = models.findUserByName(username);
    const hash = user
      ? user.password_hash
      : '$2a$12$0000000000000000000000000000000000000000000000000000a';

    const ok = await bcrypt.compare(req.body.password || '', hash);

    if (!user || !ok) {
      return res.status(401).render('login', {
        title: 'Login',
        error: genericError,
        values: { username },
      });
    }

    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = user.id;
      req.session.username = user.username;
      res.redirect('/rooms');
    });
  } catch (err) {
    next(err);
  }
});

// ----- Logout -----
router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('sid');
    res.redirect('/login');
  });
});

module.exports = router;
