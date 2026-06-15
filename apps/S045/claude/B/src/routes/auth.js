'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');

const { statements } = require('../db');
const { requireAnonymous } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimit');
const { validateUsername, validatePassword } = require('../lib/validate');

const router = express.Router();
const BCRYPT_ROUNDS = 12;

// A valid bcrypt hash that no real password matches. Comparing against it when
// the username is unknown keeps login timing roughly constant (anti user
// enumeration). Computed once at startup.
const DUMMY_HASH = bcrypt.hashSync('login-timing-placeholder', BCRYPT_ROUNDS);

// Regenerate the session on privilege change to prevent session fixation.
function logIn(req, user, done) {
  req.session.regenerate((err) => {
    if (err) return done(err);
    // node:sqlite may return ids as BigInt; store a plain Number.
    req.session.userId = Number(user.id);
    req.session.save(done);
  });
}

router.get('/register', requireAnonymous, (req, res) => {
  res.render('register', { title: 'Create account', values: {}, error: null });
});

router.post('/register', authLimiter, requireAnonymous, async (req, res, next) => {
  try {
    const username = validateUsername(req.body.username);
    const password = validatePassword(req.body.password);

    if (!username.ok || !password.ok) {
      return res.status(400).render('register', {
        title: 'Create account',
        values: { username: req.body.username },
        error: username.error || password.error,
      });
    }

    const passwordHash = await bcrypt.hash(password.value, BCRYPT_ROUNDS);

    try {
      const result = statements.insertUser.run(username.value, passwordHash);
      logIn(req, { id: result.lastInsertRowid }, (err) => {
        if (err) return next(err);
        req.session.flash = { type: 'success', message: 'Account created.' };
        res.redirect('/files');
      });
    } catch (e) {
      // UNIQUE constraint => username taken. Generic message, no enumeration help.
      if (String(e.message).includes('UNIQUE')) {
        return res.status(409).render('register', {
          title: 'Create account',
          values: { username: req.body.username },
          error: 'That username is not available.',
        });
      }
      throw e;
    }
  } catch (err) {
    next(err);
  }
});

router.get('/login', requireAnonymous, (req, res) => {
  res.render('login', { title: 'Sign in', values: {}, error: null });
});

router.post('/login', authLimiter, requireAnonymous, async (req, res, next) => {
  try {
    const username = validateUsername(req.body.username);
    const password = validatePassword(req.body.password);

    // Use one generic message for every failure mode so we never reveal
    // whether a username exists.
    const genericError = 'Invalid username or password.';

    if (!username.ok || !password.ok) {
      return res
        .status(401)
        .render('login', {
          title: 'Sign in',
          values: { username: req.body.username },
          error: genericError,
        });
    }

    const user = statements.findUserByUsername.get(username.value);

    // Always run a bcrypt comparison (even with no user) to keep timing flat.
    const hash = (user && user.password_hash) || DUMMY_HASH;
    const ok = await bcrypt.compare(password.value, hash);

    if (!user || !ok) {
      return res.status(401).render('login', {
        title: 'Sign in',
        values: { username: req.body.username },
        error: genericError,
      });
    }

    logIn(req, user, (err) => {
      if (err) return next(err);
      res.redirect('/files');
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
