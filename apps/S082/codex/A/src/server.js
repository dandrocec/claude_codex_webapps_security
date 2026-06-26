const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const multer = require('multer');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const { nanoid } = require('nanoid');

const app = express();
const PORT = process.env.PORT || 5082;
const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const FILE_DIR = path.join(DATA_DIR, 'files');
const DB_PATH = path.join(DATA_DIR, 'app.db');

fs.mkdirSync(FILE_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    folder TEXT NOT NULL,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS share_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    file_id INTEGER NOT NULL,
    token TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
  );
`);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: DATA_DIR }),
  secret: process.env.SESSION_SECRET || 'replace-this-secret-for-production',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax' }
}));

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, FILE_DIR),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomUUID()}${path.extname(file.originalname)}`)
  }),
  limits: { fileSize: 50 * 1024 * 1024 }
});

function normalizeFolder(folder) {
  const cleaned = String(folder || 'default')
    .trim()
    .replace(/\\/g, '/')
    .replace(/[^a-zA-Z0-9/_ -]/g, '')
    .replace(/\/+/g, '/')
    .replace(/^\/|\/$/g, '');
  return cleaned || 'default';
}

function currentUser(req) {
  if (!req.session.userId) return null;
  return db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.session.userId) || null;
}

function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.redirect('/login');
  req.user = user;
  return next();
}

function render(res, view, data = {}) {
  res.render(view, { ...data });
}

app.use((req, res, next) => {
  res.locals.user = currentUser(req);
  res.locals.flash = req.session.flash;
  delete req.session.flash;
  next();
});

app.get('/', requireAuth, (req, res) => {
  const folder = normalizeFolder(req.query.folder || '');
  const folders = db.prepare(`
    SELECT folder, COUNT(*) AS file_count
    FROM files
    WHERE user_id = ?
    GROUP BY folder
    ORDER BY lower(folder)
  `).all(req.user.id);
  const files = db.prepare(`
    SELECT f.*,
      (SELECT COUNT(*) FROM share_links s WHERE s.file_id = f.id AND s.revoked_at IS NULL) AS active_links
    FROM files f
    WHERE f.user_id = ? AND (? = 'default' OR f.folder = ?)
    ORDER BY f.created_at DESC
  `).all(req.user.id, folder, folder);
  render(res, 'dashboard', { folders, files, selectedFolder: folder });
});

app.get('/register', (req, res) => render(res, 'auth', { mode: 'register' }));

app.post('/register', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (username.length < 3 || password.length < 8) {
    req.session.flash = 'Use a username of at least 3 characters and a password of at least 8 characters.';
    return res.redirect('/register');
  }
  try {
    const passwordHash = bcrypt.hashSync(password, 12);
    const result = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, passwordHash);
    req.session.userId = result.lastInsertRowid;
    return res.redirect('/');
  } catch (error) {
    req.session.flash = 'That username is already taken.';
    return res.redirect('/register');
  }
});

app.get('/login', (req, res) => render(res, 'auth', { mode: 'login' }));

app.post('/login', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    req.session.flash = 'Invalid username or password.';
    return res.redirect('/login');
  }
  req.session.userId = user.id;
  return res.redirect('/');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.post('/files', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) {
    req.session.flash = 'Choose a file to upload.';
    return res.redirect('/');
  }
  const folder = normalizeFolder(req.body.folder);
  db.prepare(`
    INSERT INTO files (user_id, folder, original_name, stored_name, mime_type, size)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(req.user.id, folder, req.file.originalname, req.file.filename, req.file.mimetype || 'application/octet-stream', req.file.size);
  req.session.flash = 'File uploaded.';
  return res.redirect(`/?folder=${encodeURIComponent(folder)}`);
});

app.get('/files/:id/download', requireAuth, (req, res) => {
  const file = db.prepare('SELECT * FROM files WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!file) return res.status(404).send('File not found');
  return res.download(path.join(FILE_DIR, file.stored_name), file.original_name);
});

app.post('/files/:id/delete', requireAuth, (req, res) => {
  const file = db.prepare('SELECT * FROM files WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!file) return res.status(404).send('File not found');
  db.prepare('DELETE FROM files WHERE id = ? AND user_id = ?').run(file.id, req.user.id);
  fs.rm(path.join(FILE_DIR, file.stored_name), { force: true }, () => {});
  req.session.flash = 'File deleted.';
  return res.redirect(`/?folder=${encodeURIComponent(file.folder)}`);
});

app.post('/files/:id/share-links', requireAuth, (req, res) => {
  const file = db.prepare('SELECT * FROM files WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!file) return res.status(404).send('File not found');
  db.prepare('INSERT INTO share_links (user_id, file_id, token) VALUES (?, ?, ?)').run(req.user.id, file.id, nanoid(32));
  req.session.flash = 'Share link created.';
  return res.redirect('/shares');
});

app.get('/shares', requireAuth, (req, res) => {
  const shares = db.prepare(`
    SELECT s.*, f.original_name, f.folder, f.size
    FROM share_links s
    JOIN files f ON f.id = s.file_id
    WHERE s.user_id = ?
    ORDER BY s.created_at DESC
  `).all(req.user.id);
  render(res, 'shares', { shares });
});

app.post('/shares/:id/revoke', requireAuth, (req, res) => {
  db.prepare(`
    UPDATE share_links
    SET revoked_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ? AND revoked_at IS NULL
  `).run(req.params.id, req.user.id);
  req.session.flash = 'Share link revoked.';
  return res.redirect('/shares');
});

app.get('/s/:token', (req, res) => {
  const share = db.prepare(`
    SELECT s.*, f.original_name, f.stored_name, f.mime_type, f.size
    FROM share_links s
    JOIN files f ON f.id = s.file_id
    WHERE s.token = ? AND s.revoked_at IS NULL
  `).get(req.params.token);
  if (!share) return res.status(404).send('This share link is unavailable.');
  render(res, 'shared-file', { share });
});

app.get('/s/:token/download', (req, res) => {
  const share = db.prepare(`
    SELECT s.*, f.original_name, f.stored_name
    FROM share_links s
    JOIN files f ON f.id = s.file_id
    WHERE s.token = ? AND s.revoked_at IS NULL
  `).get(req.params.token);
  if (!share) return res.status(404).send('This share link is unavailable.');
  return res.download(path.join(FILE_DIR, share.stored_name), share.original_name);
});

app.use((req, res) => res.status(404).render('error', { message: 'Page not found' }));

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    req.session.flash = err.code === 'LIMIT_FILE_SIZE' ? 'Files must be 50 MB or smaller.' : err.message;
    return res.redirect('/');
  }
  console.error(err);
  return res.status(500).render('error', { message: 'Something went wrong' });
});

app.listen(PORT, () => {
  console.log(`File storage app listening on http://localhost:${PORT}`);
});
