'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');

const { Users } = require('../models');
const { credentialRules, handleValidation } = require('../middleware/validators');

const router = express.Router();

// Throttle authentication attempts to slow credential stuffing / brute force.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many attempts. Please wait a few minutes and try again.',
});

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/admin');
  res.render('login', { errors: [], values: {} });
});

router.post(
  '/login',
  loginLimiter,
  credentialRules,
  handleValidation('login', (req) => ({ values: { username: req.body.username } })),
  async (req, res, next) => {
    try {
      const { username, password } = req.body;
      const user = Users.findByUsername(username);

      // Always run a hash comparison to keep timing uniform whether or not the
      // user exists, and use a generic message so we don't reveal which field
      // was wrong (user enumeration protection).
      // Valid-format bcrypt hash (of a random value) used only to keep timing
      // uniform for unknown users. The `!user` check below is the real guard.
      const hash = user
        ? user.password_hash
        : '$2a$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW';
      const ok = await bcrypt.compare(password, hash);

      if (!user || !ok) {
        res.status(401);
        return res.render('login', {
          errors: ['Invalid username or password.'],
          values: { username },
        });
      }

      // Prevent session fixation: issue a fresh session on privilege change.
      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.userId = user.id;
        req.session.save((saveErr) => {
          if (saveErr) return next(saveErr);
          res.redirect('/admin');
        });
      });
    } catch (err) {
      next(err);
    }
  }
);

router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('sid');
    res.redirect('/');
  });
});

module.exports = router;
