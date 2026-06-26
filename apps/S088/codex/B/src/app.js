require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStoreFactory = require('connect-sqlite3');
const bcrypt = require('bcrypt');
const helmet = require('helmet');
const csrf = require('csurf');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const { body, validationResult } = require('express-validator');
const FileType = require('file-type');
const Database = require('better-sqlite3');

const app = express();
const SQLiteStore = SQLiteStoreFactory(session);

const PORT = Number(process.env.PORT || 5088);
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET must be set to at least 32 characters.');
}

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.resolve(ROOT, 'data');
const DB_PATH = path.resolve(ROOT, process.env.DATABASE_PATH || 'data/app.sqlite');
const UPLOAD_DIR = path.resolve(ROOT, process.env.UPLOAD_DIR || 'storage/uploads');
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 5 * 1024 * 1024);
const COOKIE_SECURE = String(process.env.COOKIE_SECURE || 'true').toLowerCase() === 'true';
const BCRYPT_ROUNDS = 12;

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS group_members (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, user_id)
);
CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  original_name TEXT NOT NULL,
  current_version_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS document_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version_no INTEGER NOT NULL,
  stored_name TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  note TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(document_id, version_no)
);
CREATE TABLE IF NOT EXISTS shares (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  resource_type TEXT NOT NULL CHECK(resource_type IN ('document','folder')),
  resource_id INTEGER NOT NULL,
  target_type TEXT NOT NULL CHECK(target_type IN ('user','group')),
  target_id INTEGER NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('view','edit')),
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(resource_type, resource_id, target_type, target_id)
);
`);

const stmt = {
  userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  userById: db.prepare('SELECT id, email, display_name FROM users WHERE id = ?'),
  insertUser: db.prepare('INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?)'),
  ensureRootFolder: db.prepare('INSERT INTO folders (owner_id, parent_id, name) VALUES (?, NULL, ?)'),
  rootFolder: db.prepare('SELECT * FROM folders WHERE owner_id = ? AND parent_id IS NULL ORDER BY id LIMIT 1'),
  folderById: db.prepare('SELECT * FROM folders WHERE id = ?'),
  docById: db.prepare('SELECT * FROM documents WHERE id = ?'),
  versionById: db.prepare('SELECT * FROM document_versions WHERE id = ?'),
  currentVersion: db.prepare('SELECT * FROM document_versions WHERE id = ?'),
  nextVersion: db.prepare('SELECT COALESCE(MAX(version_no), 0) + 1 AS n FROM document_versions WHERE document_id = ?'),
  userGroups: db.prepare('SELECT group_id FROM group_members WHERE user_id = ?'),
  allUsers: db.prepare('SELECT id, email, display_name FROM users ORDER BY email'),
  ownGroups: db.prepare('SELECT * FROM groups WHERE owner_id = ? ORDER BY name'),
  groupsForUser: db.prepare(`
    SELECT g.* FROM groups g
    JOIN group_members gm ON gm.group_id = g.id
    WHERE gm.user_id = ?
    ORDER BY g.name
  `)
};

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"]
    }
  }
}));
app.use(express.urlencoded({ extended: false, limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public'), { index: false, maxAge: '1h' }));
app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: DATA_DIR }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  name: 'dms.sid',
  cookie: {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 8
  }
}));
const csrfProtection = csrf();
app.use((req, res, next) => {
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (req.method !== 'GET' && contentType.startsWith('multipart/form-data')) return next();
  return csrfProtection(req, res, next);
});
app.use((req, res, next) => {
  res.locals.csrfToken = req.csrfToken ? req.csrfToken() : '';
  res.locals.user = req.session.userId ? stmt.userById.get(req.session.userId) : null;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
});

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 }
});

function flash(req, type, message) {
  req.session.flash = { type, message };
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  return next();
}

function rootFolderFor(userId) {
  let folder = stmt.rootFolder.get(userId);
  if (!folder) {
    stmt.ensureRootFolder.run(userId, 'My Documents');
    folder = stmt.rootFolder.get(userId);
  }
  return folder;
}

function validationFailure(req, res, view, status = 400, extra = {}) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(status).render(view, { errors: errors.array(), ...extra });
  }
  return null;
}

function userGroupIds(userId) {
  return stmt.userGroups.all(userId).map((row) => row.group_id);
}

function sharePerm(resourceType, resourceId, userId) {
  const direct = db.prepare(`
    SELECT role FROM shares
    WHERE resource_type = ? AND resource_id = ? AND target_type = 'user' AND target_id = ?
  `).get(resourceType, resourceId, userId);
  const groupIds = userGroupIds(userId);
  let groupRole = null;
  if (groupIds.length) {
    const placeholders = groupIds.map(() => '?').join(',');
    groupRole = db.prepare(`
      SELECT role FROM shares
      WHERE resource_type = ? AND resource_id = ? AND target_type = 'group'
        AND target_id IN (${placeholders})
      ORDER BY CASE role WHEN 'edit' THEN 1 ELSE 2 END
      LIMIT 1
    `).get(resourceType, resourceId, ...groupIds);
  }
  const roles = [direct && direct.role, groupRole && groupRole.role].filter(Boolean);
  if (roles.includes('edit')) return 'edit';
  if (roles.includes('view')) return 'view';
  return null;
}

function canFolder(userId, folderId, desired) {
  let folder = stmt.folderById.get(folderId);
  const seen = new Set();
  while (folder && !seen.has(folder.id)) {
    seen.add(folder.id);
    if (folder.owner_id === userId) return true;
    const role = sharePerm('folder', folder.id, userId);
    if (role === 'edit' || (desired === 'view' && role === 'view')) return true;
    folder = folder.parent_id ? stmt.folderById.get(folder.parent_id) : null;
  }
  return false;
}

function canDocument(userId, docId, desired) {
  const doc = stmt.docById.get(docId);
  if (!doc) return false;
  if (doc.owner_id === userId) return true;
  const docRole = sharePerm('document', docId, userId);
  if (docRole === 'edit' || (desired === 'view' && docRole === 'view')) return true;
  return canFolder(userId, doc.folder_id, desired);
}

function canonicalUploadPath(storedName) {
  const full = path.resolve(UPLOAD_DIR, storedName);
  if (!full.startsWith(UPLOAD_DIR + path.sep)) throw new Error('Invalid upload path.');
  return full;
}

function printableText(buffer) {
  if (!buffer.length) return false;
  let bad = 0;
  for (const b of buffer) {
    const ok = b === 9 || b === 10 || b === 13 || (b >= 32 && b <= 126) || b >= 194;
    if (!ok) bad += 1;
  }
  return bad / buffer.length < 0.02;
}

async function inspectUpload(file) {
  if (!file || !file.buffer || !file.originalname) throw new Error('Choose a file to upload.');
  const detected = await FileType.fromBuffer(file.buffer);
  const allowed = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    gif: 'image/gif'
  };
  if (detected && allowed[detected.ext]) {
    return { ext: detected.ext, mime: allowed[detected.ext] };
  }
  if (!detected && printableText(file.buffer)) {
    return { ext: 'txt', mime: 'text/plain; charset=utf-8' };
  }
  throw new Error('Unsupported file type. Allowed: PDF, PNG, JPG, GIF, TXT.');
}

function safeDisplayName(name) {
  return String(name || 'document').replace(/[^\w .()-]/g, '').trim().slice(0, 180) || 'document';
}

async function saveVersion(file, documentId, userId, note) {
  const inspected = await inspectUpload(file);
  const storedName = `${crypto.randomUUID()}.${inspected.ext}`;
  const target = canonicalUploadPath(storedName);
  const sha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');
  fs.writeFileSync(target, file.buffer, { flag: 'wx', mode: 0o600 });
  const versionNo = stmt.nextVersion.get(documentId).n;
  const result = db.prepare(`
    INSERT INTO document_versions
      (document_id, version_no, stored_name, mime_type, size_bytes, sha256, note, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(documentId, versionNo, storedName, inspected.mime, file.size, sha256, note || null, userId);
  db.prepare('UPDATE documents SET current_version_id = ? WHERE id = ?').run(result.lastInsertRowid, documentId);
  return result.lastInsertRowid;
}

app.get('/', (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  return res.redirect('/dashboard');
});

app.get('/register', (req, res) => res.render('auth', { mode: 'register', errors: [] }));
app.post('/register', authLimiter,
  body('email').isEmail().normalizeEmail(),
  body('displayName').trim().isLength({ min: 1, max: 80 }),
  body('password').isLength({ min: 12, max: 200 }),
  async (req, res, next) => {
    const failed = validationFailure(req, res, 'auth', 400, { mode: 'register' });
    if (failed) return failed;
    try {
      const { email, displayName, password } = req.body;
      if (stmt.userByEmail.get(email)) {
        return res.status(409).render('auth', { mode: 'register', errors: [{ msg: 'Email is already registered.' }] });
      }
      const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      const tx = db.transaction(() => {
        const result = stmt.insertUser.run(email, hash, displayName.trim());
        stmt.ensureRootFolder.run(result.lastInsertRowid, 'My Documents');
        return result.lastInsertRowid;
      });
      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.userId = tx();
        res.redirect('/dashboard');
      });
    } catch (err) {
      next(err);
    }
  }
);

app.get('/login', (req, res) => res.render('auth', { mode: 'login', errors: [] }));
app.post('/login', authLimiter,
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 1, max: 200 }),
  async (req, res, next) => {
    const failed = validationFailure(req, res, 'auth', 400, { mode: 'login' });
    if (failed) return failed;
    try {
      const user = stmt.userByEmail.get(req.body.email);
      const ok = user && await bcrypt.compare(req.body.password, user.password_hash);
      if (!ok) return res.status(401).render('auth', { mode: 'login', errors: [{ msg: 'Invalid email or password.' }] });
      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.userId = user.id;
        res.redirect('/dashboard');
      });
    } catch (err) {
      next(err);
    }
  }
);

app.post('/logout', requireAuth, (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('dms.sid');
    res.redirect('/login');
  });
});

app.get('/dashboard', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const root = rootFolderFor(userId);
  const folderId = Number(req.query.folder || root.id);
  if (!canFolder(userId, folderId, 'view')) return res.status(404).render('error', { message: 'Folder not found.' });
  const folder = stmt.folderById.get(folderId);
  const folders = db.prepare('SELECT * FROM folders WHERE parent_id = ? ORDER BY name').all(folderId)
    .filter((item) => canFolder(userId, item.id, 'view'));
  const docs = db.prepare(`
    SELECT d.*, v.version_no, v.size_bytes, v.created_at AS version_at
    FROM documents d
    LEFT JOIN document_versions v ON v.id = d.current_version_id
    WHERE d.folder_id = ?
    ORDER BY d.title
  `).all(folderId).filter((item) => canDocument(userId, item.id, 'view'));
  const sharedDocs = db.prepare(`
    SELECT DISTINCT d.*, v.version_no
    FROM documents d
    LEFT JOIN document_versions v ON v.id = d.current_version_id
    LEFT JOIN shares s ON s.resource_type = 'document' AND s.resource_id = d.id
    WHERE d.owner_id <> ?
  `).all(userId).filter((item) => canDocument(userId, item.id, 'view'));
  res.render('dashboard', { folder, folders, docs, sharedDocs, canEditFolder: canFolder(userId, folderId, 'edit') });
});

app.post('/folders', requireAuth,
  body('parentId').isInt({ min: 1 }),
  body('name').trim().isLength({ min: 1, max: 120 }),
  (req, res) => {
    const parentId = Number(req.body.parentId);
    if (!validationResult(req).isEmpty() || !canFolder(req.session.userId, parentId, 'edit')) {
      flash(req, 'error', 'Unable to create folder.');
      return res.redirect('/dashboard');
    }
    db.prepare('INSERT INTO folders (owner_id, parent_id, name) VALUES (?, ?, ?)').run(req.session.userId, parentId, req.body.name.trim());
    res.redirect(`/dashboard?folder=${parentId}`);
  }
);

app.post('/documents', requireAuth, upload.single('document'), csrfProtection, async (req, res, next) => {
  const folderId = Number(req.body.folderId);
  if (!Number.isInteger(folderId) || !canFolder(req.session.userId, folderId, 'edit')) {
    flash(req, 'error', 'Upload is not allowed for this folder.');
    return res.redirect('/dashboard');
  }
  try {
    const inspected = await inspectUpload(req.file);
    const title = safeDisplayName(req.body.title || req.file.originalname);
    const originalName = safeDisplayName(req.file.originalname);
    const storedName = `${crypto.randomUUID()}.${inspected.ext}`;
    const target = canonicalUploadPath(storedName);
    const sha256 = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    fs.writeFileSync(target, req.file.buffer, { flag: 'wx', mode: 0o600 });
    const tx = db.transaction(() => {
      const docResult = db.prepare(`
        INSERT INTO documents (owner_id, folder_id, title, original_name)
        VALUES (?, ?, ?, ?)
      `).run(req.session.userId, folderId, title, originalName);
      const versionResult = db.prepare(`
        INSERT INTO document_versions
          (document_id, version_no, stored_name, mime_type, size_bytes, sha256, note, created_by)
        VALUES (?, 1, ?, ?, ?, ?, ?, ?)
      `).run(docResult.lastInsertRowid, storedName, inspected.mime, req.file.size, sha256, req.body.note || null, req.session.userId);
      db.prepare('UPDATE documents SET current_version_id = ? WHERE id = ?').run(versionResult.lastInsertRowid, docResult.lastInsertRowid);
      return docResult.lastInsertRowid;
    });
    const docId = tx();
    res.redirect(`/documents/${docId}`);
  } catch (err) {
    if (err.message && err.message.startsWith('Unsupported')) {
      flash(req, 'error', err.message);
      return res.redirect(`/dashboard?folder=${folderId}`);
    }
    next(err);
  }
});

app.get('/documents/:id', requireAuth, (req, res) => {
  const docId = Number(req.params.id);
  if (!Number.isInteger(docId) || !canDocument(req.session.userId, docId, 'view')) {
    return res.status(404).render('error', { message: 'Document not found.' });
  }
  const doc = stmt.docById.get(docId);
  const versions = db.prepare(`
    SELECT v.*, u.display_name AS created_by_name
    FROM document_versions v
    JOIN users u ON u.id = v.created_by
    WHERE v.document_id = ?
    ORDER BY v.version_no DESC
  `).all(docId);
  const shares = db.prepare('SELECT * FROM shares WHERE resource_type = ? AND resource_id = ? ORDER BY target_type, target_id').all('document', docId);
  res.render('document', {
    doc,
    versions,
    shares,
    users: stmt.allUsers.all().filter((u) => u.id !== req.session.userId),
    groups: stmt.ownGroups.all(req.session.userId),
    canEdit: canDocument(req.session.userId, docId, 'edit'),
    isOwner: doc.owner_id === req.session.userId
  });
});

app.get('/documents/:id/download', requireAuth, (req, res, next) => {
  const docId = Number(req.params.id);
  if (!Number.isInteger(docId) || !canDocument(req.session.userId, docId, 'view')) {
    return res.status(404).render('error', { message: 'Document not found.' });
  }
  const doc = stmt.docById.get(docId);
  const version = stmt.currentVersion.get(doc.current_version_id);
  if (!version) return res.status(404).render('error', { message: 'File not found.' });
  const full = canonicalUploadPath(version.stored_name);
  res.setHeader('Content-Type', version.mime_type);
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.original_name)}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(full, (err) => {
    if (err) next(err);
  });
});

app.post('/documents/:id/versions', requireAuth, upload.single('document'), csrfProtection, async (req, res, next) => {
  const docId = Number(req.params.id);
  if (!Number.isInteger(docId) || !canDocument(req.session.userId, docId, 'edit')) {
    return res.status(404).render('error', { message: 'Document not found.' });
  }
  try {
    await saveVersion(req.file, docId, req.session.userId, req.body.note);
    res.redirect(`/documents/${docId}`);
  } catch (err) {
    if (err.message && (err.message.startsWith('Unsupported') || err.message.startsWith('Choose'))) {
      flash(req, 'error', err.message);
      return res.redirect(`/documents/${docId}`);
    }
    next(err);
  }
});

app.post('/documents/:id/restore/:versionId', requireAuth, (req, res) => {
  const docId = Number(req.params.id);
  const versionId = Number(req.params.versionId);
  const version = Number.isInteger(versionId) ? stmt.versionById.get(versionId) : null;
  if (!Number.isInteger(docId) || !version || version.document_id !== docId || !canDocument(req.session.userId, docId, 'edit')) {
    return res.status(404).render('error', { message: 'Version not found.' });
  }
  db.prepare('UPDATE documents SET current_version_id = ? WHERE id = ?').run(versionId, docId);
  res.redirect(`/documents/${docId}`);
});

app.post('/shares', requireAuth,
  body('resourceType').isIn(['document', 'folder']),
  body('resourceId').isInt({ min: 1 }),
  body('targetType').isIn(['user', 'group']),
  body('targetId').isInt({ min: 1 }),
  body('role').isIn(['view', 'edit']),
  (req, res) => {
    const errors = validationResult(req);
    const resourceId = Number(req.body.resourceId);
    const resourceType = req.body.resourceType;
    const back = resourceType === 'document' ? `/documents/${resourceId}` : `/dashboard?folder=${resourceId}`;
    const ownerOk = resourceType === 'document'
      ? (stmt.docById.get(resourceId) || {}).owner_id === req.session.userId
      : (stmt.folderById.get(resourceId) || {}).owner_id === req.session.userId;
    if (!errors.isEmpty() || !ownerOk) {
      flash(req, 'error', 'Only owners can share resources.');
      return res.redirect(back);
    }
    const targetId = Number(req.body.targetId);
    if (req.body.targetType === 'user' && !stmt.userById.get(targetId)) {
      flash(req, 'error', 'User not found.');
      return res.redirect(back);
    }
    if (req.body.targetType === 'group') {
      const group = db.prepare('SELECT * FROM groups WHERE id = ? AND owner_id = ?').get(targetId, req.session.userId);
      if (!group) {
        flash(req, 'error', 'Group not found.');
        return res.redirect(back);
      }
    }
    db.prepare(`
      INSERT INTO shares (resource_type, resource_id, target_type, target_id, role, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(resource_type, resource_id, target_type, target_id)
      DO UPDATE SET role = excluded.role
    `).run(resourceType, resourceId, req.body.targetType, targetId, req.body.role, req.session.userId);
    res.redirect(back);
  }
);

app.get('/groups', requireAuth, (req, res) => {
  res.render('groups', {
    groups: stmt.ownGroups.all(req.session.userId),
    memberOf: stmt.groupsForUser.all(req.session.userId),
    users: stmt.allUsers.all().filter((u) => u.id !== req.session.userId),
    members: db.prepare(`
      SELECT gm.group_id, u.email, u.display_name
      FROM group_members gm JOIN users u ON u.id = gm.user_id
      ORDER BY u.email
    `).all()
  });
});

app.post('/groups', requireAuth,
  body('name').trim().isLength({ min: 1, max: 120 }),
  (req, res) => {
    if (!validationResult(req).isEmpty()) {
      flash(req, 'error', 'Invalid group name.');
      return res.redirect('/groups');
    }
    db.prepare('INSERT INTO groups (owner_id, name) VALUES (?, ?)').run(req.session.userId, req.body.name.trim());
    res.redirect('/groups');
  }
);

app.post('/groups/:id/members', requireAuth,
  body('userId').isInt({ min: 1 }),
  (req, res) => {
    const groupId = Number(req.params.id);
    const userId = Number(req.body.userId);
    const group = db.prepare('SELECT * FROM groups WHERE id = ? AND owner_id = ?').get(groupId, req.session.userId);
    if (!group || !stmt.userById.get(userId)) {
      flash(req, 'error', 'Unable to add member.');
      return res.redirect('/groups');
    }
    db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)').run(groupId, userId);
    res.redirect('/groups');
  }
);

app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).render('error', { message: 'Invalid or expired form token.' });
  }
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    flash(req, 'error', 'Uploaded file is too large.');
    return res.redirect(req.get('Referrer') || '/dashboard');
  }
  console.error(err);
  return res.status(500).render('error', { message: 'An unexpected error occurred.' });
});

app.listen(PORT, () => {
  console.log(`Document management app listening on port ${PORT}`);
});
