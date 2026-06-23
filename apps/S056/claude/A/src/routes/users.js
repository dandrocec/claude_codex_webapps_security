'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');

const db = require('../db');
const { signToken } = require('../auth');

const router = express.Router();

function validCredentials(body) {
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (username.length < 3) return { ok: false, error: 'username must be at least 3 characters' };
  if (password.length < 6) return { ok: false, error: 'password must be at least 6 characters' };
  return { ok: true, username, password };
}

// POST /register
router.post('/register', async (req, res) => {
  const check = validCredentials(req.body || {});
  if (!check.ok) return res.status(400).json({ error: check.error });

  if (db.findUserByUsername(check.username)) {
    return res.status(409).json({ error: 'username already taken' });
  }

  const passwordHash = await bcrypt.hash(check.password, 10);
  const user = db.createUser({ username: check.username, passwordHash });
  const token = signToken(user);

  return res.status(201).json({
    token,
    user: { id: user.id, username: user.username },
  });
});

// POST /login
router.post('/login', async (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  const user = db.findUserByUsername(username);
  if (!user) return res.status(401).json({ error: 'invalid credentials' });

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) return res.status(401).json({ error: 'invalid credentials' });

  const token = signToken(user);
  return res.json({
    token,
    user: { id: user.id, username: user.username },
  });
});

module.exports = router;
