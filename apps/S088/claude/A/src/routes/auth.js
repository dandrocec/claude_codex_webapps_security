'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { requireAuth, asyncHandler } = require('../middleware');

const router = express.Router();

router.post(
  '/register',
  asyncHandler((req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'username and password are required' });
    }
    const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (exists) return res.status(409).json({ error: 'username already taken' });

    const hash = bcrypt.hashSync(password, 10);
    const info = db
      .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
      .run(username, hash);

    req.session.userId = info.lastInsertRowid;
    req.session.username = username;
    res.status(201).json({ id: info.lastInsertRowid, username });
  })
);

router.post(
  '/login',
  asyncHandler((req, res) => {
    const { username, password } = req.body || {};
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
      return res.status(401).json({ error: 'invalid credentials' });
    }
    req.session.userId = user.id;
    req.session.username = user.username;
    res.json({ id: user.id, username: user.username });
  })
);

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ id: req.session.userId, username: req.session.username });
});

// Directory of users — used by the share dialog. No passwords exposed.
router.get('/users', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT id, username FROM users ORDER BY username').all());
});

module.exports = router;
