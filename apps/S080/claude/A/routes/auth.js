'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/connection');

const router = express.Router();

const findUser = db.prepare('SELECT * FROM users WHERE username = ?');

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { title: 'Log in' });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = findUser.get((username || '').trim());

  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    req.flash('error', 'Invalid username or password.');
    return res.redirect('/login');
  }

  req.session.user = { id: user.id, username: user.username, role: user.role };
  req.flash('success', `Welcome back, ${user.username}.`);
  res.redirect('/');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
