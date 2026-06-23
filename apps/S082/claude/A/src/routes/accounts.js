'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');

const router = express.Router();

router.get('/register', (req, res) => {
  if (res.locals.currentUser) return res.redirect('/');
  res.render('register');
});

router.post('/register', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');

  if (username.length < 3 || username.length > 32) {
    req.flash('error', 'Username must be 3–32 characters.');
    return res.redirect('/register');
  }
  if (password.length < 6) {
    req.flash('error', 'Password must be at least 6 characters.');
    return res.redirect('/register');
  }

  const exists = db.prepare('SELECT 1 FROM users WHERE username = ?').get(username);
  if (exists) {
    req.flash('error', 'That username is taken.');
    return res.redirect('/register');
  }

  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .run(username, hash);

  req.session.userId = info.lastInsertRowid;
  req.flash('success', 'Welcome! Your account is ready.');
  res.redirect('/');
});

router.get('/login', (req, res) => {
  if (res.locals.currentUser) return res.redirect('/');
  res.render('login');
});

router.post('/login', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    req.flash('error', 'Invalid username or password.');
    return res.redirect('/login');
  }

  // Prevent session fixation: issue a fresh session on login.
  req.session.regenerate((err) => {
    if (err) {
      req.flash('error', 'Could not start a session. Try again.');
      return res.redirect('/login');
    }
    req.session.userId = user.id;
    res.redirect('/');
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
