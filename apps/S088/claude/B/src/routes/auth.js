'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const { rateLimit } = require('express-rate-limit');
const { db } = require('../db');
const {
  isValidUsername,
  isValidEmail,
  isValidPassword,
  flash,
} = require('../security');

const router = express.Router();
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS) || 12;

const insertUser = db.prepare(
  'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)'
);
const findByUsername = db.prepare('SELECT * FROM users WHERE username = ?');
const findByUsernameOrEmail = db.prepare(
  'SELECT id FROM users WHERE username = ? OR email = ?'
);

// Throttle authentication attempts to blunt brute-force / credential stuffing.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: undefined,
});

router.get('/register', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('register', { values: {} });
});

router.post('/register', authLimiter, async (req, res, next) => {
  try {
    const username = (req.body.username || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const { password, confirm } = req.body;

    const errors = [];
    if (!isValidUsername(username)) errors.push('Username must be 3-32 chars (letters, digits, . _ -).');
    if (!isValidEmail(email)) errors.push('Please provide a valid email address.');
    if (!isValidPassword(password)) errors.push('Password must be at least 12 characters.');
    if (password !== confirm) errors.push('Passwords do not match.');

    if (errors.length === 0 && findByUsernameOrEmail.get(username, email)) {
      // Generic message to avoid confirming which identifier exists.
      errors.push('Could not create account with those details.');
    }

    if (errors.length > 0) {
      errors.forEach((e) => flash(req, 'error', e));
      return res.status(400).render('register', { values: { username, email } });
    }

    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const info = insertUser.run(username, email, hash);

    // Prevent session fixation: establish a fresh session on privilege change.
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = info.lastInsertRowid;
      flash(req, 'success', 'Account created. Welcome!');
      res.redirect('/');
    });
  } catch (err) {
    next(err);
  }
});

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('login', { values: {} });
});

router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const username = (req.body.username || '').trim();
    const { password } = req.body;

    const user = findByUsername.get(username);

    // Always run a bcrypt comparison to keep timing uniform whether or not the
    // user exists, and never reveal which field was wrong.
    const hash = user ? user.password_hash : '$2b$12$' + 'x'.repeat(53);
    const ok = await bcrypt.compare(String(password || ''), hash);

    if (!user || !ok) {
      flash(req, 'error', 'Invalid username or password.');
      return res.status(401).render('login', { values: { username } });
    }

    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = user.id;
      flash(req, 'success', `Signed in as ${user.username}.`);
      res.redirect('/');
    });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('docman.sid');
    res.redirect('/login');
  });
});

module.exports = router;
