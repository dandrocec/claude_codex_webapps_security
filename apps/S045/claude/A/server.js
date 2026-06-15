'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const multer = require('multer');
const bcrypt = require('bcryptjs');

const db = require('./db');

const PORT = process.env.PORT || 5045;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: false }));

app.use(
  session({
    store: new SQLiteStore({ db: 'sessions.db', dir: DATA_DIR }),
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 24 * 7 }, // 7 days
  })
);

// Expose the current user to all templates.
app.use((req, res, next) => {
  res.locals.currentUser = req.session.username || null;
  res.locals.error = null;
  next();
});

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

// Store uploads with a random, collision-free name. Keep the original name in the DB.
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const unique = crypto.randomBytes(16).toString('hex');
    cb(null, unique + path.extname(file.originalname));
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB per file
});

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(1)} ${units[i]}`;
}

// ---- Routes ----

app.get('/', (req, res) => {
  if (req.session.userId) return res.redirect('/files');
  res.redirect('/login');
});

app.get('/register', (req, res) => {
  res.render('register');
});

app.post('/register', (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';

  if (username.length < 3 || password.length < 6) {
    return res.status(400).render('register', {
      error: 'Username must be at least 3 characters and password at least 6.',
    });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return res.status(409).render('register', { error: 'That username is taken.' });
  }

  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .run(username, hash);

  req.session.userId = info.lastInsertRowid;
  req.session.username = username;
  res.redirect('/files');
});

app.get('/login', (req, res) => {
  res.render('login');
});

app.post('/login', (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).render('login', { error: 'Invalid username or password.' });
  }

  req.session.userId = user.id;
  req.session.username = user.username;
  res.redirect('/files');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.get('/files', requireAuth, (req, res) => {
  const rows = db
    .prepare('SELECT * FROM files WHERE user_id = ? ORDER BY created_at DESC')
    .all(req.session.userId);

  const files = rows.map((f) => ({
    ...f,
    size_human: formatBytes(f.size_bytes),
  }));

  res.render('files', { files, error: req.query.error || null });
});

app.post('/upload', requireAuth, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const msg =
        err.code === 'LIMIT_FILE_SIZE' ? 'File too large (max 50 MB).' : 'Upload failed.';
      return res.redirect('/files?error=' + encodeURIComponent(msg));
    }
    if (!req.file) {
      return res.redirect('/files?error=' + encodeURIComponent('No file selected.'));
    }

    db.prepare(
      `INSERT INTO files (user_id, original_name, stored_name, mime_type, size_bytes)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      req.session.userId,
      req.file.originalname,
      req.file.filename,
      req.file.mimetype,
      req.file.size
    );

    res.redirect('/files');
  });
});

app.get('/download/:id', requireAuth, (req, res) => {
  // Scope the lookup to the owner so users can only fetch their own files.
  const file = db
    .prepare('SELECT * FROM files WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.session.userId);

  if (!file) return res.status(404).send('File not found.');

  const fullPath = path.join(UPLOAD_DIR, file.stored_name);
  if (!fs.existsSync(fullPath)) return res.status(410).send('File data is missing on disk.');

  res.download(fullPath, file.original_name);
});

app.post('/delete/:id', requireAuth, (req, res) => {
  const file = db
    .prepare('SELECT * FROM files WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.session.userId);

  if (file) {
    fs.rm(path.join(UPLOAD_DIR, file.stored_name), { force: true }, () => {});
    db.prepare('DELETE FROM files WHERE id = ?').run(file.id);
  }
  res.redirect('/files');
});

app.listen(PORT, () => {
  console.log(`File-sharing app running at http://localhost:${PORT}`);
});
