'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const db = require('../db');

const router = express.Router();

const usernameRules = body('username')
  .trim()
  .isLength({ min: 3, max: 30 })
  .withMessage('Username must be 3-30 characters.')
  .matches(/^[a-zA-Z0-9_]+$/)
  .withMessage('Username may only contain letters, numbers, and underscores.');

const passwordRules = body('password')
  .isLength({ min: 8, max: 200 })
  .withMessage('Password must be at least 8 characters.');

// Regenerate the session on privilege change to prevent session fixation.
function login(req, res, userId, done) {
  req.session.regenerate((err) => {
    if (err) return done(err);
    req.session.userId = userId;
    req.session.save(done);
  });
}

router.get('/register', (req, res) => {
  if (req.user) return res.redirect('/feed');
  res.render('register', { title: 'Register', errors: [], values: {} });
});

router.post('/register', usernameRules, passwordRules, async (req, res, next) => {
  try {
    const errors = validationResult(req);
    const { username } = req.body;
    if (!errors.isEmpty()) {
      return res.status(400).render('register', {
        title: 'Register',
        errors: errors.array(),
        values: { username },
      });
    }

    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
      return res.status(409).render('register', {
        title: 'Register',
        errors: [{ msg: 'That username is already taken.' }],
        values: { username },
      });
    }

    const passwordHash = await bcrypt.hash(req.body.password, 12);
    const result = db
      .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
      .run(username, passwordHash);

    login(req, res, result.lastInsertRowid, (err) => {
      if (err) return next(err);
      req.flash('success', 'Welcome, ' + username + '!');
      res.redirect('/feed');
    });
  } catch (err) {
    next(err);
  }
});

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/feed');
  res.render('login', { title: 'Log in', errors: [], values: {} });
});

router.post('/login', usernameRules, body('password').notEmpty(), async (req, res, next) => {
  try {
    const { username } = req.body;
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).render('login', {
        title: 'Log in',
        errors: [{ msg: 'Invalid username or password.' }],
        values: { username },
      });
    }

    const user = db.prepare('SELECT id, password_hash FROM users WHERE username = ?').get(username);

    // Always run a hash comparison to keep timing roughly constant whether or not
    // the user exists, and never reveal which field was wrong.
    const hash = user ? user.password_hash : '$2a$12$............................................';
    const ok = await bcrypt.compare(req.body.password, hash);

    if (!user || !ok) {
      return res.status(401).render('login', {
        title: 'Log in',
        errors: [{ msg: 'Invalid username or password.' }],
        values: { username },
      });
    }

    login(req, res, user.id, (err) => {
      if (err) return next(err);
      res.redirect('/feed');
    });
  } catch (err) {
    next(err);
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
