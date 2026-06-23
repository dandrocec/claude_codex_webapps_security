'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { body } = require('express-validator');

const db = require('../db');
const config = require('../config');
const { handleValidation } = require('../validation');
const { issueCsrfToken } = require('../middleware/csrf');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const BCRYPT_ROUNDS = 12;

// Prepared statements use parameter binding — no string concatenation, so SQL
// injection is structurally impossible here.
const insertUser = db.prepare(
  'INSERT INTO users (username, password_hash) VALUES (?, ?)'
);
const findUserByUsername = db.prepare(
  'SELECT id, username, password_hash FROM users WHERE username = ?'
);

/** Sets the HttpOnly JWT auth cookie. */
function setAuthCookie(res, user) {
  const token = jwt.sign(
    { sub: user.id, username: user.username },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
  res.cookie(config.authCookieName, token, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'strict',
    path: '/',
  });
}

const usernameRules = body('username')
  .isString()
  .trim()
  .isLength({ min: 3, max: 32 })
  .withMessage('Username must be 3-32 characters.')
  .matches(/^[a-zA-Z0-9_.-]+$/)
  .withMessage('Username may contain letters, numbers, and . _ - only.');

const passwordRules = body('password')
  .isString()
  .isLength({ min: 8, max: 128 })
  .withMessage('Password must be 8-128 characters.');

// POST /register
router.post(
  '/register',
  usernameRules,
  passwordRules,
  handleValidation,
  async (req, res, next) => {
    try {
      const { username, password } = req.body;
      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

      let info;
      try {
        info = insertUser.run(username, passwordHash);
      } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          return res.status(409).json({ error: 'Username is already taken.' });
        }
        throw err;
      }

      const user = { id: info.lastInsertRowid, username };
      setAuthCookie(res, user);
      const csrfToken = issueCsrfToken(res);

      return res.status(201).json({
        user: { id: user.id, username: user.username },
        csrfToken,
      });
    } catch (err) {
      return next(err);
    }
  }
);

// POST /login
router.post(
  '/login',
  body('username').isString().trim().notEmpty(),
  body('password').isString().notEmpty(),
  handleValidation,
  async (req, res, next) => {
    try {
      const { username, password } = req.body;
      const user = findUserByUsername.get(username);

      // Always run a bcrypt comparison to avoid user-enumeration via timing.
      const hash = user
        ? user.password_hash
        : '$2b$12$............................................................';
      const ok = await bcrypt.compare(password, hash);

      if (!user || !ok) {
        return res.status(401).json({ error: 'Invalid credentials.' });
      }

      setAuthCookie(res, user);
      const csrfToken = issueCsrfToken(res);

      return res.json({
        user: { id: user.id, username: user.username },
        csrfToken,
      });
    } catch (err) {
      return next(err);
    }
  }
);

// POST /logout — clears the auth + CSRF cookies.
router.post('/logout', requireAuth, (req, res) => {
  res.clearCookie(config.authCookieName, { path: '/' });
  res.clearCookie(config.csrfCookieName, { path: '/' });
  return res.json({ message: 'Logged out.' });
});

module.exports = router;
