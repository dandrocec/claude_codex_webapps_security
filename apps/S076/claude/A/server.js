'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcryptjs');

const db = require('./db');

const app = express();
const PORT = process.env.PORT || 5076;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    store: new SQLiteStore({ db: 'sessions.db', dir: __dirname }),
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 7, // 1 week
    },
  })
);

// --- Helpers --------------------------------------------------------------

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

function publicUser(row) {
  return { id: row.id, username: row.username };
}

// --- Auth routes ----------------------------------------------------------

app.post('/api/register', (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';

  if (username.length < 3 || username.length > 32) {
    return res.status(400).json({ error: 'Username must be 3-32 characters' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return res.status(409).json({ error: 'Username already taken' });
  }

  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)')
    .run(username, hash, Date.now());

  req.session.userId = info.lastInsertRowid;
  req.session.username = username;
  res.status(201).json({ user: { id: info.lastInsertRowid, username } });
});

app.post('/api/login', (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  req.session.userId = user.id;
  req.session.username = user.username;
  res.json({ user: publicUser(user) });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (!req.session.userId) {
    return res.json({ user: null });
  }
  res.json({ user: { id: req.session.userId, username: req.session.username } });
});

// --- Room routes ----------------------------------------------------------

app.get('/api/rooms', requireAuth, (req, res) => {
  const rooms = db
    .prepare(
      `SELECT r.id, r.name, r.created_at, COUNT(m.id) AS message_count
         FROM rooms r
         LEFT JOIN messages m ON m.room_id = r.id
        GROUP BY r.id
        ORDER BY r.name COLLATE NOCASE ASC`
    )
    .all();
  res.json({ rooms });
});

app.post('/api/rooms', requireAuth, (req, res) => {
  const name = (req.body.name || '').trim();
  if (name.length < 1 || name.length > 50) {
    return res.status(400).json({ error: 'Room name must be 1-50 characters' });
  }

  const existing = db.prepare('SELECT id FROM rooms WHERE name = ? COLLATE NOCASE').get(name);
  if (existing) {
    return res.status(409).json({ error: 'A room with that name already exists' });
  }

  const info = db
    .prepare('INSERT INTO rooms (name, created_by, created_at) VALUES (?, ?, ?)')
    .run(name, req.session.userId, Date.now());

  res.status(201).json({ room: { id: info.lastInsertRowid, name } });
});

// --- Message routes -------------------------------------------------------

app.get('/api/rooms/:roomId/messages', requireAuth, (req, res) => {
  const roomId = Number(req.params.roomId);
  const room = db.prepare('SELECT id, name FROM rooms WHERE id = ?').get(roomId);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  // Optional incremental fetch: only messages newer than ?after=<id>.
  const after = Number(req.query.after) || 0;

  const messages = db
    .prepare(
      `SELECT m.id, m.body, m.created_at, u.username
         FROM messages m
         JOIN users u ON u.id = m.user_id
        WHERE m.room_id = ? AND m.id > ?
        ORDER BY m.id ASC`
    )
    .all(roomId, after);

  res.json({ room, messages });
});

app.post('/api/rooms/:roomId/messages', requireAuth, (req, res) => {
  const roomId = Number(req.params.roomId);
  const body = (req.body.body || '').trim();

  if (body.length < 1 || body.length > 2000) {
    return res.status(400).json({ error: 'Message must be 1-2000 characters' });
  }

  const room = db.prepare('SELECT id FROM rooms WHERE id = ?').get(roomId);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  const info = db
    .prepare('INSERT INTO messages (room_id, user_id, body, created_at) VALUES (?, ?, ?, ?)')
    .run(roomId, req.session.userId, body, Date.now());

  res.status(201).json({
    message: {
      id: info.lastInsertRowid,
      body,
      created_at: Date.now(),
      username: req.session.username,
    },
  });
});

// --- Start ----------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`Chat app running at http://localhost:${PORT}`);
});
