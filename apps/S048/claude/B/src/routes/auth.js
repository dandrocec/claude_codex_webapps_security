'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');

const db = require('../db');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session.user) {
    return res.redirect('/dashboard');
  }
  res.render('login', { error: null, values: { username: '' } });
});

const validateLogin = [
  body('username').trim().isLength({ min: 1, max: 100 }),
  body('password').isLength({ min: 1, max: 200 }),
];

router.post('/login', validateLogin, (req, res, next) => {
  const result = validationResult(req);
  const username = (req.body.username || '').trim();

  // Generic error message for any failure mode avoids leaking which usernames
  // exist (OWASP A07 — identification & authentication failures).
  const fail = () =>
    res.status(401).render('login', {
      error: 'Invalid username or password.',
      values: { username },
    });

  if (!result.isEmpty()) {
    return fail();
  }

  try {
    const user = db
      .prepare('SELECT id, username, password_hash, role FROM users WHERE username = ?')
      .get(username);

    // Always run a bcrypt comparison to keep timing roughly constant whether or
    // not the user exists.
    const hash = user ? user.password_hash : '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
    const match = bcrypt.compareSync(req.body.password, hash);

    if (!user || !match) {
      return fail();
    }

    // Prevent session fixation: regenerate the session on privilege change.
    req.session.regenerate((err) => {
      if (err) {
        return next(err);
      }
      req.session.user = { id: user.id, username: user.username, role: user.role };
      res.redirect('/dashboard');
    });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) {
      return next(err);
    }
    res.clearCookie('sid');
    res.redirect('/login');
  });
});

module.exports = router;
