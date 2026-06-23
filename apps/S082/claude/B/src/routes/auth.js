'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');

const db = require('../db');
const { validateUsername, validatePassword } = require('../lib/validate');
const { verifyCsrf } = require('../middleware/security');

const router = express.Router();

const BCRYPT_ROUNDS = 12;

// Throttle auth attempts to slow credential stuffing / brute force.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many attempts. Please try again later.',
});

const getUserByName = db.prepare('SELECT * FROM users WHERE username = ?');
const insertUser = db.prepare(
  'INSERT INTO users (username, password_hash) VALUES (?, ?)'
);

// Regenerate the session on privilege change to prevent session fixation.
function login(req, user, done) {
  req.session.regenerate((err) => {
    if (err) return done(err);
    req.session.userId = user.id;
    req.session.username = user.username;
    return req.session.save(done);
  });
}

router.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('register', { error: null, values: {} });
});

router.post('/register', authLimiter, verifyCsrf, async (req, res, next) => {
  try {
    const username = validateUsername(req.body.username);
    const password = validatePassword(req.body.password);
    if (!username || !password) {
      return res.status(400).render('register', {
        error:
          'Username must be 3-32 chars (letters, digits, . _ -) and password at least 10 chars.',
        values: { username: req.body.username || '' },
      });
    }

    if (getUserByName.get(username)) {
      return res.status(409).render('register', {
        error: 'That username is already taken.',
        values: { username },
      });
    }

    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const info = insertUser.run(username, hash);
    login(req, { id: info.lastInsertRowid, username }, (err) => {
      if (err) return next(err);
      return res.redirect('/');
    });
  } catch (err) {
    next(err);
  }
});

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('login', { error: null, values: {} });
});

router.post('/login', authLimiter, verifyCsrf, async (req, res, next) => {
  try {
    const username = validateUsername(req.body.username);
    const password =
      typeof req.body.password === 'string' ? req.body.password : '';

    // Generic error message + work even when user is missing, to avoid
    // username enumeration and timing oracles.
    const user = username ? getUserByName.get(username) : null;
    const hash = user
      ? user.password_hash
      : '$2b$12$0000000000000000000000000000000000000000000000000000z';
    const ok = await bcrypt.compare(password, hash);

    if (!user || !ok) {
      return res.status(401).render('login', {
        error: 'Invalid username or password.',
        values: { username: req.body.username || '' },
      });
    }

    login(req, user, (err) => {
      if (err) return next(err);
      return res.redirect('/');
    });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', verifyCsrf, (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('sid');
    return res.redirect('/login');
  });
});

module.exports = router;
