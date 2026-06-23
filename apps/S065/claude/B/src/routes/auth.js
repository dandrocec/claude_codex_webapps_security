'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');

const { Users } = require('../models');

const router = express.Router();

const BCRYPT_ROUNDS = 12;

// Username: 3-30 chars, letters/digits/_/- only. Password: min 8 chars.
const registerValidators = [
  body('username')
    .trim()
    .isLength({ min: 3, max: 30 })
    .withMessage('Username must be 3-30 characters.')
    .matches(/^[A-Za-z0-9_-]+$/)
    .withMessage('Username may only contain letters, numbers, _ and -.'),
  body('password')
    .isLength({ min: 8, max: 200 })
    .withMessage('Password must be at least 8 characters.'),
];

const loginValidators = [
  body('username').trim().notEmpty(),
  body('password').notEmpty(),
];

router.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('register', { errors: [], values: {} });
});

router.post('/register', registerValidators, async (req, res, next) => {
  try {
    const errors = validationResult(req);
    const { username, password } = req.body;
    if (!errors.isEmpty()) {
      return res.status(400).render('register', {
        errors: errors.array().map((e) => e.msg),
        values: { username },
      });
    }

    if (Users.findByUsername(username)) {
      return res.status(409).render('register', {
        errors: ['That username is already taken.'],
        values: { username },
      });
    }

    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const userId = Users.create(username, hash);

    // Regenerate session to prevent fixation, then log the user in.
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = userId;
      res.redirect('/');
    });
  } catch (err) {
    next(err);
  }
});

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('login', { errors: [], values: {} });
});

router.post('/login', loginValidators, async (req, res, next) => {
  try {
    const { username, password } = req.body;
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res
        .status(400)
        .render('login', { errors: ['Enter your username and password.'], values: { username } });
    }

    const user = Users.findByUsername(username);
    // Always run a hash comparison to reduce username-enumeration timing signal.
    const hash = user ? user.password_hash : '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva';
    const ok = await bcrypt.compare(password, hash);

    if (!user || !ok) {
      return res
        .status(401)
        .render('login', { errors: ['Invalid username or password.'], values: { username } });
    }

    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = user.id;
      res.redirect('/');
    });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('sid');
    res.redirect('/');
  });
});

module.exports = router;
