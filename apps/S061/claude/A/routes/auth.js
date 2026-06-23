'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');

const router = express.Router();

router.get('/register', (req, res) => {
  if (req.user) return res.redirect('/dashboard');
  res.render('register', { title: 'Register', error: null, form: {} });
});

router.post('/register', (req, res) => {
  const name = (req.body.name || '').trim();
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';
  const role = req.body.role === 'instructor' ? 'instructor' : 'student';

  const rerender = (error) =>
    res.status(400).render('register', {
      title: 'Register',
      error,
      form: { name, email, role },
    });

  if (!name || !email || !password) return rerender('All fields are required.');
  if (password.length < 6) return rerender('Password must be at least 6 characters.');

  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (exists) return rerender('An account with that email already exists.');

  const password_hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(name, email, password_hash, role);

  req.session.userId = info.lastInsertRowid;
  res.redirect('/dashboard');
});

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/dashboard');
  res.render('login', { title: 'Login', error: null, form: {} });
});

router.post('/login', (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).render('login', {
      title: 'Login',
      error: 'Invalid email or password.',
      form: { email },
    });
  }

  req.session.userId = user.id;
  res.redirect('/dashboard');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

module.exports = router;
