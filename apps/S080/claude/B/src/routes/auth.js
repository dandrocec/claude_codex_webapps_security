'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const { Users } = require('../models');

const router = express.Router();

// A valid bcrypt hash of a random value, used to equalise response timing when
// the username does not exist (mitigates username-enumeration via timing).
const DUMMY_HASH = bcrypt.hashSync('account-does-not-exist-placeholder', 12);

// Throttle login attempts to slow down credential-stuffing / brute force.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: undefined,
  handler: (req, res) =>
    res.status(429).render('login', {
      title: 'Sign in',
      error: 'Too many login attempts. Please wait a few minutes and try again.',
      username: '',
    }),
});

router.get('/login', (req, res) => {
  if (req.session.userId) {
    return res.redirect('/');
  }
  return res.render('login', { title: 'Sign in', error: null, username: '' });
});

router.post(
  '/login',
  loginLimiter,
  body('username').trim().isLength({ min: 1, max: 64 }),
  body('password').isLength({ min: 1, max: 256 }),
  (req, res) => {
    const errors = validationResult(req);
    const username = (req.body.username || '').trim();

    const renderError = () =>
      res.status(401).render('login', {
        title: 'Sign in',
        // Generic message — do not reveal whether the username exists.
        error: 'Invalid username or password.',
        username,
      });

    if (!errors.isEmpty()) {
      return renderError();
    }

    const user = Users.findByUsername(username);
    // Always run a bcrypt compare to reduce username-enumeration timing leaks.
    const hash = user ? user.password_hash : DUMMY_HASH;
    const ok = bcrypt.compareSync(req.body.password, hash);

    if (!user || !ok) {
      return renderError();
    }

    // Prevent session fixation: issue a fresh session on privilege change.
    return req.session.regenerate((err) => {
      if (err) {
        return renderError();
      }
      req.session.userId = user.id;
      req.session.role = user.role;
      req.session.username = user.username;
      return res.redirect('/');
    });
  }
);

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('sid');
    res.redirect('/login');
  });
});

module.exports = router;
