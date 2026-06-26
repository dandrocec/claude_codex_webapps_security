const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');

const PORT = process.env.PORT || 5098;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.sqlite');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    owner_id INTEGER NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS document_access (
    document_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('owner', 'edit', 'view')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (document_id, user_id),
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

const statements = {
  getUserByName: db.prepare('SELECT * FROM users WHERE lower(name) = lower(?)'),
  getUserById: db.prepare('SELECT * FROM users WHERE id = ?'),
  createUser: db.prepare('INSERT INTO users (name) VALUES (?)'),
  createDocument: db.prepare('INSERT INTO documents (title, content, owner_id) VALUES (?, ?, ?)'),
  addAccess: db.prepare(`
    INSERT INTO document_access (document_id, user_id, role)
    VALUES (?, ?, ?)
    ON CONFLICT(document_id, user_id) DO UPDATE SET role = excluded.role
  `),
  listDocumentsForUser: db.prepare(`
    SELECT d.id, d.title, d.updated_at AS updatedAt, da.role,
      owner.name AS ownerName,
      (SELECT COUNT(*) FROM document_access WHERE document_id = d.id) AS accessCount
    FROM documents d
    JOIN document_access da ON da.document_id = d.id
    JOIN users owner ON owner.id = d.owner_id
    WHERE da.user_id = ?
    ORDER BY datetime(d.updated_at) DESC, d.id DESC
  `),
  getDocumentForUser: db.prepare(`
    SELECT d.id, d.title, d.content, d.owner_id AS ownerId, d.updated_at AS updatedAt,
      da.role, owner.name AS ownerName
    FROM documents d
    JOIN document_access da ON da.document_id = d.id
    JOIN users owner ON owner.id = d.owner_id
    WHERE d.id = ? AND da.user_id = ?
  `),
  listAccess: db.prepare(`
    SELECT u.id, u.name, da.role, da.created_at AS addedAt
    FROM document_access da
    JOIN users u ON u.id = da.user_id
    WHERE da.document_id = ?
    ORDER BY CASE da.role WHEN 'owner' THEN 0 WHEN 'edit' THEN 1 ELSE 2 END, lower(u.name)
  `),
  updateDocumentContent: db.prepare(`
    UPDATE documents
    SET content = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `),
  updateDocumentTitle: db.prepare(`
    UPDATE documents
    SET title = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `),
  removeAccess: db.prepare(`
    DELETE FROM document_access
    WHERE document_id = ? AND user_id = ? AND role != 'owner'
  `)
};

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function requireName(req, res, next) {
  const rawName = String(req.header('x-user-name') || req.query.user || '').trim();
  if (!rawName) {
    return res.status(401).json({ error: 'Choose a user name first.' });
  }

  let user = statements.getUserByName.get(rawName);
  if (!user) {
    const result = statements.createUser.run(rawName.slice(0, 60));
    user = statements.getUserById.get(result.lastInsertRowid);
  }

  req.user = user;
  return next();
}

function getVisibleDocument(req, res) {
  const document = statements.getDocumentForUser.get(Number(req.params.id), req.user.id);
  if (!document) {
    res.status(404).json({ error: 'Document not found or access denied.' });
    return null;
  }
  return document;
}

function canEdit(role) {
  return role === 'owner' || role === 'edit';
}

function accessPayload(documentId) {
  return statements.listAccess.all(documentId);
}

app.get('/api/me', requireName, (req, res) => {
  res.json({ id: req.user.id, name: req.user.name });
});

app.get('/api/documents', requireName, (req, res) => {
  res.json({ documents: statements.listDocumentsForUser.all(req.user.id) });
});

app.post('/api/documents', requireName, (req, res) => {
  const title = String(req.body.title || '').trim().slice(0, 120) || 'Untitled document';
  const content = String(req.body.content || '');

  const create = db.transaction(() => {
    const result = statements.createDocument.run(title, content, req.user.id);
    statements.addAccess.run(result.lastInsertRowid, req.user.id, 'owner');
    return result.lastInsertRowid;
  });

  const id = create();
  const document = statements.getDocumentForUser.get(id, req.user.id);
  res.status(201).json({ document, access: accessPayload(id) });
});

app.get('/api/documents/:id', requireName, (req, res) => {
  const document = getVisibleDocument(req, res);
  if (!document) return;
  res.json({ document, access: accessPayload(document.id) });
});

app.patch('/api/documents/:id', requireName, (req, res) => {
  const document = getVisibleDocument(req, res);
  if (!document) return;
  if (!canEdit(document.role)) {
    return res.status(403).json({ error: 'You only have view access.' });
  }

  const title = String(req.body.title || '').trim().slice(0, 120);
  if (!title) {
    return res.status(400).json({ error: 'Document title is required.' });
  }

  statements.updateDocumentTitle.run(title, document.id);
  const updated = statements.getDocumentForUser.get(document.id, req.user.id);
  io.to(`document:${document.id}`).emit('document:renamed', {
    id: document.id,
    title: updated.title,
    updatedAt: updated.updatedAt
  });
  res.json({ document: updated });
});

app.post('/api/documents/:id/access', requireName, (req, res) => {
  const document = getVisibleDocument(req, res);
  if (!document) return;
  if (document.role !== 'owner') {
    return res.status(403).json({ error: 'Only the owner can invite collaborators.' });
  }

  const collaboratorName = String(req.body.name || '').trim().slice(0, 60);
  const role = String(req.body.role || '').trim();
  if (!collaboratorName) {
    return res.status(400).json({ error: 'Collaborator name is required.' });
  }
  if (!['view', 'edit'].includes(role)) {
    return res.status(400).json({ error: 'Role must be view or edit.' });
  }

  const invite = db.transaction(() => {
    let collaborator = statements.getUserByName.get(collaboratorName);
    if (!collaborator) {
      const result = statements.createUser.run(collaboratorName);
      collaborator = statements.getUserById.get(result.lastInsertRowid);
    }
    if (collaborator.id === document.ownerId) return;
    statements.addAccess.run(document.id, collaborator.id, role);
  });

  invite();
  const access = accessPayload(document.id);
  io.to(`document:${document.id}`).emit('access:updated', { id: document.id, access });
  res.status(201).json({ access });
});

app.delete('/api/documents/:id/access/:userId', requireName, (req, res) => {
  const document = getVisibleDocument(req, res);
  if (!document) return;
  if (document.role !== 'owner') {
    return res.status(403).json({ error: 'Only the owner can remove access.' });
  }

  statements.removeAccess.run(document.id, Number(req.params.userId));
  const access = accessPayload(document.id);
  io.to(`document:${document.id}`).emit('access:updated', { id: document.id, access });
  res.json({ access });
});

io.use((socket, next) => {
  const name = String(socket.handshake.auth.userName || '').trim();
  if (!name) return next(new Error('Choose a user name first.'));

  let user = statements.getUserByName.get(name);
  if (!user) {
    const result = statements.createUser.run(name.slice(0, 60));
    user = statements.getUserById.get(result.lastInsertRowid);
  }

  socket.user = user;
  return next();
});

io.on('connection', (socket) => {
  socket.on('document:join', ({ documentId }, callback) => {
    const document = statements.getDocumentForUser.get(Number(documentId), socket.user.id);
    if (!document) {
      if (callback) callback({ error: 'Document not found or access denied.' });
      return;
    }

    socket.join(`document:${document.id}`);
    if (callback) callback({ document, access: accessPayload(document.id) });
  });

  socket.on('document:edit', ({ documentId, content }, callback) => {
    const document = statements.getDocumentForUser.get(Number(documentId), socket.user.id);
    if (!document) {
      if (callback) callback({ error: 'Document not found or access denied.' });
      return;
    }
    if (!canEdit(document.role)) {
      if (callback) callback({ error: 'You only have view access.' });
      return;
    }

    const cleanContent = String(content || '');
    statements.updateDocumentContent.run(cleanContent, document.id);
    const updated = statements.getDocumentForUser.get(document.id, socket.user.id);
    socket.to(`document:${document.id}`).emit('document:updated', {
      id: document.id,
      content: cleanContent,
      editor: socket.user.name,
      updatedAt: updated.updatedAt
    });
    if (callback) callback({ ok: true, updatedAt: updated.updatedAt });
  });
});

server.listen(PORT, () => {
  console.log(`Collaborative editor running at http://localhost:${PORT}`);
});
