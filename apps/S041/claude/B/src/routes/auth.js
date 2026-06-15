'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { Users } = require('../models');
const { verifyCsrf, redirectIfAuthed } = require('../middleware/security');
const { loginValidators, collectErrors } = require('../middleware/validators');

const router = express.Router();

// Throttle login attempts to blunt credential-stuffing / brute force.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: undefined,
});

router.get('/login', redirectIfAuthed, (req, res) => {
  res.render('login', { title: 'Editor login', errors: null, username: '' });
});

router.post(
  '/login',
  redirectIfAuthed,
  loginLimiter,
  verifyCsrf,
  loginValidators,
  (req, res) => {
    const errors = collectErrors(req);
    const { username, password } = req.body;

    // Generic message for any failure so we don't reveal which field was wrong
    // (user enumeration protection).
    const fail = () =>
      res.status(401).render('login', {
        title: 'Editor login',
        errors: ['Invalid username or password.'],
        username: typeof username === 'string' ? username : '',
      });

    if (errors) return fail();

    const user = Users.findByUsername(username);
    // Always run a bcrypt comparison to keep timing roughly constant whether or
    // not the user exists.
    const hash = user
      ? user.password_hash
      : '$2a$12$0000000000000000000000000000000000000000000000000000z';
    const match = bcrypt.compareSync(password, hash);

    if (!user || !match) return fail();

    // Prevent session fixation: issue a fresh session on privilege change.
    req.session.regenerate((err) => {
      if (err) return fail();
      req.session.user = { id: user.id, username: user.username };
      req.session.save(() => res.redirect('/admin'));
    });
  }
);

router.post('/logout', verifyCsrf, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('sid');
    res.redirect('/');
  });
});

module.exports = router;
