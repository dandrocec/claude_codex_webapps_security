'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');

const db = require('./db');
const { getRole, canView, canEdit, accessList } = require('./access');

const PORT = process.env.PORT || 5098;
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const sessionMiddleware = session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: __dirname }),
  secret: process.env.SESSION_SECRET || 'dev-only-collab-editor-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 },
});
app.use(sessionMiddleware);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

function findUser(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

// ---------------------------------------------------------------------------
// Auth routes
// ---------------------------------------------------------------------------

app.post('/api/register', (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';
  if (username.length < 3 || password.length < 4) {
    return res.status(400).json({ error: 'Username (3+) and password (4+) required.' });
  }
  if (findUser(username)) {
    return res.status(409).json({ error: 'Username already taken.' });
  }
  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .run(username, hash);
  req.session.userId = info.lastInsertRowid;
  req.session.username = username;
  res.json({ id: info.lastInsertRowid, username });
});

app.post('/api/login', (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';
  const user = findUser(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }
  req.session.userId = user.id;
  req.session.username = user.username;
  res.json({ id: user.id, username: user.username });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  res.json({ user: { id: req.session.userId, username: req.session.username } });
});

// ---------------------------------------------------------------------------
// Document routes
// ---------------------------------------------------------------------------

// List every document the current user owns or has been invited to.
app.get('/api/documents', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const docs = db
    .prepare(
      `SELECT d.id, d.title, d.updated_at,
              u.username AS owner,
              CASE WHEN d.owner_id = @uid THEN 'owner' ELSE p.role END AS role
         FROM documents d
         JOIN users u ON u.id = d.owner_id
         LEFT JOIN permissions p ON p.document_id = d.id AND p.user_id = @uid
        WHERE d.owner_id = @uid OR p.user_id = @uid
        ORDER BY d.updated_at DESC`
    )
    .all({ uid });
  res.json({ documents: docs });
});

app.post('/api/documents', requireAuth, (req, res) => {
  const title = (req.body.title || 'Untitled').trim() || 'Untitled';
  const info = db
    .prepare('INSERT INTO documents (title, content, owner_id) VALUES (?, ?, ?)')
    .run(title, '', req.session.userId);
  res.json({ id: info.lastInsertRowid, title });
});

// Fetch a single document (content + the caller's role + access list).
app.get('/api/documents/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const role = getRole(id, req.session.userId);
  if (!canView(role)) return res.status(403).json({ error: 'No access to this document.' });

  const doc = db.prepare('SELECT id, title, content, updated_at FROM documents WHERE id = ?').get(id);
  res.json({ document: doc, role, access: accessList(id) });
});

// Invite a collaborator by username with a 'view' or 'edit' role.
app.post('/api/documents/:id/collaborators', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const role = getRole(id, req.session.userId);
  if (role !== 'owner') return res.status(403).json({ error: 'Only the owner can invite.' });

  const username = (req.body.username || '').trim();
  const newRole = req.body.role === 'edit' ? 'edit' : 'view';
  const target = findUser(username);
  if (!target) return res.status(404).json({ error: 'No such user.' });
  if (target.id === req.session.userId) {
    return res.status(400).json({ error: 'You already own this document.' });
  }

  db.prepare(
    `INSERT INTO permissions (document_id, user_id, role) VALUES (?, ?, ?)
     ON CONFLICT(document_id, user_id) DO UPDATE SET role = excluded.role`
  ).run(id, target.id, newRole);

  io.to(`doc:${id}`).emit('access-changed', { access: accessList(id) });
  res.json({ access: accessList(id) });
});

// Remove a collaborator.
app.delete('/api/documents/:id/collaborators/:userId', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const userId = Number(req.params.userId);
  const role = getRole(id, req.session.userId);
  if (role !== 'owner') return res.status(403).json({ error: 'Only the owner can remove access.' });

  db.prepare('DELETE FROM permissions WHERE document_id = ? AND user_id = ?').run(id, userId);
  io.to(`doc:${id}`).emit('access-changed', { access: accessList(id), removedUserId: userId });
  res.json({ access: accessList(id) });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ---------------------------------------------------------------------------
// Real-time collaboration via Socket.IO
// ---------------------------------------------------------------------------

// Share the Express session with Socket.IO so we know who is connecting.
io.engine.use(sessionMiddleware);

io.on('connection', (socket) => {
  const userId = socket.request.session?.userId;
  if (!userId) {
    socket.disconnect(true);
    return;
  }

  // Join a document room after verifying view access.
  socket.on('join', (docId) => {
    const id = Number(docId);
    const role = getRole(id, userId);
    if (!canView(role)) {
      socket.emit('error-msg', 'You do not have access to this document.');
      return;
    }
    socket.join(`doc:${id}`);
    socket.data.docId = id;
    socket.data.role = role;
  });

  // A live edit: persist it and broadcast to everyone else in the room.
  socket.on('edit', ({ docId, content }) => {
    const id = Number(docId);
    const role = getRole(id, userId);
    if (!canEdit(role)) {
      socket.emit('error-msg', 'You only have view access.');
      return;
    }
    db.prepare("UPDATE documents SET content = ?, updated_at = datetime('now') WHERE id = ?").run(
      String(content),
      id
    );
    socket.to(`doc:${id}`).emit('doc-update', { content: String(content) });
  });
});

server.listen(PORT, () => {
  console.log(`Collaborative editor running at http://localhost:${PORT}`);
});
