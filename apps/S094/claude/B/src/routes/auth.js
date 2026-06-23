'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { validateEmail, validatePassword } = require('../lib/validate');

const router = express.Router();

// A valid bcrypt hash used as a constant-time decoy when the email is unknown,
// so login timing does not reveal whether an account exists.
const DUMMY_HASH = bcrypt.hashSync('decoy-password-not-used', 12);

const findByEmail = db.prepare('SELECT * FROM users WHERE email = ?');
const insertUser = db.prepare(
  'INSERT INTO users (email, password_hash) VALUES (?, ?)'
);

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

router.get('/register', (req, res) => {
  if (req.user) return res.redirect('/dashboard');
  res.render('register', { title: 'Register', error: null, email: '' });
});

router.post('/register', async (req, res, next) => {
  try {
    const email = validateEmail(req.body.email);
    const password = validatePassword(req.body.password);
    if (!email.ok || !password.ok) {
      return res.status(400).render('register', {
        title: 'Register',
        error: (email.error || password.error),
        email: typeof req.body.email === 'string' ? req.body.email : '',
      });
    }

    if (findByEmail.get(email.value)) {
      // Generic message; do not confirm/deny which step failed beyond this.
      return res.status(400).render('register', {
        title: 'Register',
        error: 'Unable to register with those details.',
        email: req.body.email,
      });
    }

    const hash = await bcrypt.hash(password.value, 12);
    const info = insertUser.run(email.value, hash);

    await regenerateSession(req);
    req.session.userId = info.lastInsertRowid;
    return res.redirect('/dashboard');
  } catch (err) {
    return next(err);
  }
});

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/dashboard');
  res.render('login', { title: 'Log in', error: null, email: '' });
});

router.post('/login', async (req, res, next) => {
  try {
    const email = validateEmail(req.body.email);
    const password = validatePassword(req.body.password);

    // Always run a bcrypt comparison to keep timing roughly uniform, even when
    // the user does not exist (avoids user-enumeration via response timing).
    const user = email.ok ? findByEmail.get(email.value) : null;
    const candidate = password.ok ? password.value : 'invalid-password';
    const match = await bcrypt.compare(candidate, user ? user.password_hash : DUMMY_HASH);
    const ok = Boolean(user) && match;

    if (!ok) {
      return res.status(401).render('login', {
        title: 'Log in',
        error: 'Invalid email or password.',
        email: typeof req.body.email === 'string' ? req.body.email : '',
      });
    }

    await regenerateSession(req);
    req.session.userId = user.id;
    return res.redirect('/dashboard');
  } catch (err) {
    return next(err);
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('hub.sid');
    res.redirect('/login');
  });
});

module.exports = router;
