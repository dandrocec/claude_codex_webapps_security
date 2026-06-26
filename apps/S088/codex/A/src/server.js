const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const methodOverride = require('method-override');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { db, initDatabase } = require('./store');

const PORT = Number(process.env.PORT || 5088);
const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
initDatabase();

const app = express();
const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 50 * 1024 * 1024 }
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use('/static', express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(methodOverride('_method'));
app.use(session({
  secret: process.env.SESSION_SECRET || 'local-dev-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax' }
}));

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
});

function flash(req, type, message) {
  req.session.flash = { type, message };
}

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

function rightsRank(rights) {
  return rights === 'edit' ? 2 : rights === 'view' ? 1 : 0;
}

function bestRights(documentId, userId) {
  const owner = db.prepare('SELECT owner_id FROM documents WHERE id = ?').get(documentId);
  if (!owner) return null;
  if (owner.owner_id === userId) return 'edit';

  const direct = db.prepare(`
    SELECT rights FROM shares
    WHERE document_id = ? AND target_type = 'user' AND target_id = ?
  `).all(documentId, userId);

  const groupShares = db.prepare(`
    SELECT s.rights
    FROM shares s
    JOIN group_members gm ON gm.group_id = s.target_id
    WHERE s.document_id = ? AND s.target_type = 'group' AND gm.user_id = ?
  `).all(documentId, userId);

  return [...direct, ...groupShares]
    .map(row => row.rights)
    .sort((a, b) => rightsRank(b) - rightsRank(a))[0] || null;
}

function requireDocumentRight(level) {
  return (req, res, next) => {
    const documentId = Number(req.params.id);
    const rights = bestRights(documentId, req.session.user.id);
    if (rightsRank(rights) < rightsRank(level)) {
      flash(req, 'error', 'You do not have access to that document.');
      return res.redirect('/');
    }
    req.documentRights = rights;
    next();
  };
}

function getFolderBreadcrumbs(folderId, userId) {
  const crumbs = [];
  let current = folderId ? db.prepare('SELECT * FROM folders WHERE id = ? AND owner_id = ?').get(folderId, userId) : null;
  while (current) {
    crumbs.unshift(current);
    current = current.parent_id
      ? db.prepare('SELECT * FROM folders WHERE id = ? AND owner_id = ?').get(current.parent_id, userId)
      : null;
  }
  return crumbs;
}

function createVersion(documentId, file, userId, note) {
  const latest = db.prepare('SELECT COALESCE(MAX(version_number), 0) AS max_version FROM document_versions WHERE document_id = ?').get(documentId);
  const storedName = `${uuidv4()}${path.extname(file.originalname || '')}`;
  const finalPath = path.join(UPLOAD_DIR, storedName);
  fs.renameSync(file.path, finalPath);

  const info = db.prepare(`
    INSERT INTO document_versions
      (document_id, version_number, stored_name, original_name, mime_type, size, uploaded_by, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    documentId,
    latest.max_version + 1,
    storedName,
    file.originalname,
    file.mimetype || 'application/octet-stream',
    file.size,
    userId,
    note || ''
  );

  db.prepare('UPDATE documents SET current_version_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(info.lastInsertRowid, documentId);
}

app.get('/login', (req, res) => {
  res.render('login');
});

app.post('/login', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get((req.body.email || '').trim().toLowerCase());
  if (!user || !bcrypt.compareSync(req.body.password || '', user.password_hash)) {
    flash(req, 'error', 'Invalid email or password.');
    return res.redirect('/login');
  }
  req.session.user = { id: user.id, name: user.name, email: user.email };
  res.redirect('/');
});

app.post('/logout', requireAuth, (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.get('/', requireAuth, (req, res) => {
  const folderId = req.query.folder ? Number(req.query.folder) : null;
  const folder = folderId
    ? db.prepare('SELECT * FROM folders WHERE id = ? AND owner_id = ?').get(folderId, req.session.user.id)
    : null;
  if (folderId && !folder) {
    flash(req, 'error', 'Folder not found.');
    return res.redirect('/');
  }

  const folders = db.prepare(`
    SELECT * FROM folders
    WHERE owner_id = ? AND parent_id IS ?
    ORDER BY name COLLATE NOCASE
  `).all(req.session.user.id, folderId);

  const documents = db.prepare(`
    SELECT d.*, v.original_name, v.size, v.version_number, u.name AS owner_name
    FROM documents d
    JOIN document_versions v ON v.id = d.current_version_id
    JOIN users u ON u.id = d.owner_id
    WHERE d.owner_id = ? AND d.folder_id IS ?
    ORDER BY d.updated_at DESC
  `).all(req.session.user.id, folderId);

  const shared = db.prepare(`
    SELECT DISTINCT d.*, v.original_name, v.size, v.version_number, u.name AS owner_name
    FROM documents d
    JOIN document_versions v ON v.id = d.current_version_id
    JOIN users u ON u.id = d.owner_id
    LEFT JOIN shares su ON su.document_id = d.id AND su.target_type = 'user' AND su.target_id = ?
    LEFT JOIN shares sg ON sg.document_id = d.id AND sg.target_type = 'group'
    LEFT JOIN group_members gm ON gm.group_id = sg.target_id AND gm.user_id = ?
    WHERE d.owner_id != ? AND (su.id IS NOT NULL OR gm.id IS NOT NULL)
    ORDER BY d.updated_at DESC
  `).all(req.session.user.id, req.session.user.id, req.session.user.id);

  res.render('dashboard', {
    folder,
    folders,
    documents,
    shared,
    breadcrumbs: getFolderBreadcrumbs(folderId, req.session.user.id)
  });
});

app.post('/folders', requireAuth, (req, res) => {
  const name = (req.body.name || '').trim();
  const parentId = req.body.parent_id ? Number(req.body.parent_id) : null;
  if (!name) {
    flash(req, 'error', 'Folder name is required.');
    return res.redirect(parentId ? `/?folder=${parentId}` : '/');
  }
  if (parentId) {
    const parent = db.prepare('SELECT id FROM folders WHERE id = ? AND owner_id = ?').get(parentId, req.session.user.id);
    if (!parent) return res.redirect('/');
  }
  db.prepare('INSERT INTO folders (name, parent_id, owner_id) VALUES (?, ?, ?)')
    .run(name, parentId, req.session.user.id);
  res.redirect(parentId ? `/?folder=${parentId}` : '/');
});

app.post('/documents', requireAuth, upload.single('document'), (req, res) => {
  const folderId = req.body.folder_id ? Number(req.body.folder_id) : null;
  const title = (req.body.title || req.file?.originalname || '').trim();
  if (!req.file || !title) {
    if (req.file) fs.rmSync(req.file.path, { force: true });
    flash(req, 'error', 'Choose a file and provide a title.');
    return res.redirect(folderId ? `/?folder=${folderId}` : '/');
  }
  if (folderId) {
    const folder = db.prepare('SELECT id FROM folders WHERE id = ? AND owner_id = ?').get(folderId, req.session.user.id);
    if (!folder) {
      fs.rmSync(req.file.path, { force: true });
      return res.redirect('/');
    }
  }

  const doc = db.prepare('INSERT INTO documents (title, folder_id, owner_id) VALUES (?, ?, ?)')
    .run(title, folderId, req.session.user.id);
  createVersion(doc.lastInsertRowid, req.file, req.session.user.id, 'Initial upload');
  res.redirect(`/documents/${doc.lastInsertRowid}`);
});

app.get('/documents/:id', requireAuth, requireDocumentRight('view'), (req, res) => {
  const id = Number(req.params.id);
  const document = db.prepare(`
    SELECT d.*, v.original_name, v.size, v.version_number, u.name AS owner_name
    FROM documents d
    JOIN document_versions v ON v.id = d.current_version_id
    JOIN users u ON u.id = d.owner_id
    WHERE d.id = ?
  `).get(id);
  const versions = db.prepare(`
    SELECT v.*, u.name AS uploaded_by_name
    FROM document_versions v
    JOIN users u ON u.id = v.uploaded_by
    WHERE v.document_id = ?
    ORDER BY v.version_number DESC
  `).all(id);
  const users = db.prepare('SELECT id, name, email FROM users WHERE id != ? ORDER BY name').all(req.session.user.id);
  const groups = db.prepare('SELECT id, name FROM groups ORDER BY name').all();
  const shares = db.prepare(`
    SELECT s.*, COALESCE(u.name, g.name) AS target_name, u.email AS target_email
    FROM shares s
    LEFT JOIN users u ON s.target_type = 'user' AND u.id = s.target_id
    LEFT JOIN groups g ON s.target_type = 'group' AND g.id = s.target_id
    WHERE s.document_id = ?
    ORDER BY s.target_type, target_name
  `).all(id);

  res.render('document', {
    document,
    versions,
    users,
    groups,
    shares,
    rights: req.documentRights,
    isOwner: document.owner_id === req.session.user.id
  });
});

app.get('/documents/:id/download', requireAuth, requireDocumentRight('view'), (req, res) => {
  const versionId = req.query.version ? Number(req.query.version) : null;
  const version = versionId
    ? db.prepare('SELECT * FROM document_versions WHERE id = ? AND document_id = ?').get(versionId, Number(req.params.id))
    : db.prepare(`
        SELECT v.* FROM documents d
        JOIN document_versions v ON v.id = d.current_version_id
        WHERE d.id = ?
      `).get(Number(req.params.id));
  if (!version) return res.redirect(`/documents/${req.params.id}`);
  res.download(path.join(UPLOAD_DIR, version.stored_name), version.original_name);
});

app.post('/documents/:id/versions', requireAuth, requireDocumentRight('edit'), upload.single('document'), (req, res) => {
  if (!req.file) {
    flash(req, 'error', 'Choose a file to upload as a new version.');
    return res.redirect(`/documents/${req.params.id}`);
  }
  createVersion(Number(req.params.id), req.file, req.session.user.id, req.body.note);
  flash(req, 'success', 'New version uploaded.');
  res.redirect(`/documents/${req.params.id}`);
});

app.post('/documents/:id/restore/:versionId', requireAuth, requireDocumentRight('edit'), (req, res) => {
  const documentId = Number(req.params.id);
  const source = db.prepare('SELECT * FROM document_versions WHERE id = ? AND document_id = ?')
    .get(Number(req.params.versionId), documentId);
  if (!source) {
    flash(req, 'error', 'Version not found.');
    return res.redirect(`/documents/${documentId}`);
  }

  const sourcePath = path.join(UPLOAD_DIR, source.stored_name);
  const restoredName = `${uuidv4()}${path.extname(source.original_name || '')}`;
  fs.copyFileSync(sourcePath, path.join(UPLOAD_DIR, restoredName));
  const latest = db.prepare('SELECT COALESCE(MAX(version_number), 0) AS max_version FROM document_versions WHERE document_id = ?').get(documentId);
  const info = db.prepare(`
    INSERT INTO document_versions
      (document_id, version_number, stored_name, original_name, mime_type, size, uploaded_by, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    documentId,
    latest.max_version + 1,
    restoredName,
    source.original_name,
    source.mime_type,
    source.size,
    req.session.user.id,
    `Restored from version ${source.version_number}`
  );
  db.prepare('UPDATE documents SET current_version_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(info.lastInsertRowid, documentId);
  flash(req, 'success', `Version ${source.version_number} restored as the latest version.`);
  res.redirect(`/documents/${documentId}`);
});

app.post('/documents/:id/shares', requireAuth, requireDocumentRight('edit'), (req, res) => {
  const document = db.prepare('SELECT owner_id FROM documents WHERE id = ?').get(Number(req.params.id));
  if (document.owner_id !== req.session.user.id) {
    flash(req, 'error', 'Only the owner can change sharing.');
    return res.redirect(`/documents/${req.params.id}`);
  }
  const targetType = req.body.target_type === 'group' ? 'group' : 'user';
  const targetId = Number(req.body.target_id);
  const rights = req.body.rights === 'edit' ? 'edit' : 'view';
  db.prepare(`
    INSERT INTO shares (document_id, target_type, target_id, rights)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(document_id, target_type, target_id)
    DO UPDATE SET rights = excluded.rights
  `).run(Number(req.params.id), targetType, targetId, rights);
  res.redirect(`/documents/${req.params.id}`);
});

app.post('/documents/:id/shares/:shareId/delete', requireAuth, requireDocumentRight('edit'), (req, res) => {
  const document = db.prepare('SELECT owner_id FROM documents WHERE id = ?').get(Number(req.params.id));
  if (document.owner_id === req.session.user.id) {
    db.prepare('DELETE FROM shares WHERE id = ? AND document_id = ?').run(Number(req.params.shareId), Number(req.params.id));
  }
  res.redirect(`/documents/${req.params.id}`);
});

app.get('/groups', requireAuth, (req, res) => {
  const groups = db.prepare(`
    SELECT g.*, GROUP_CONCAT(u.name, ', ') AS members
    FROM groups g
    LEFT JOIN group_members gm ON gm.group_id = g.id
    LEFT JOIN users u ON u.id = gm.user_id
    GROUP BY g.id
    ORDER BY g.name
  `).all();
  const users = db.prepare('SELECT id, name, email FROM users ORDER BY name').all();
  res.render('groups', { groups, users });
});

app.post('/groups', requireAuth, (req, res) => {
  const name = (req.body.name || '').trim();
  const userIds = Array.isArray(req.body.user_ids) ? req.body.user_ids : [req.body.user_ids].filter(Boolean);
  if (!name) {
    flash(req, 'error', 'Group name is required.');
    return res.redirect('/groups');
  }
  const info = db.prepare('INSERT INTO groups (name) VALUES (?)').run(name);
  const addMember = db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)');
  userIds.map(Number).forEach(userId => addMember.run(info.lastInsertRowid, userId));
  res.redirect('/groups');
});

app.use((req, res) => {
  res.status(404).render('not-found');
});

app.listen(PORT, () => {
  console.log(`Document manager running at http://localhost:${PORT}`);
});
