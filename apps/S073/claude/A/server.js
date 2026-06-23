'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcryptjs');
const multer = require('multer');

const db = require('./db');

const PORT = process.env.PORT || 5073;
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: false }));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use('/static', express.static(path.join(__dirname, 'public')));

app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: DATA_DIR }),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 24 * 7 },
}));

// ---------------------------------------------------------------------------
// File uploads (multer)
// ---------------------------------------------------------------------------
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' };

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const name = crypto.randomBytes(16).toString('hex') + (EXT[file.mimetype] || '.bin');
    cb(null, name);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
  fileFilter: (req, file, cb) => cb(null, ALLOWED.has(file.mimetype)),
});

// ---------------------------------------------------------------------------
// View helpers / middleware
// ---------------------------------------------------------------------------
app.use((req, res, next) => {
  if (req.session.userId) {
    res.locals.currentUser = db
      .prepare('SELECT id, username, bio FROM users WHERE id = ?')
      .get(req.session.userId);
  } else {
    res.locals.currentUser = null;
  }
  res.locals.error = null;
  next();
});

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

function decorate(photos, viewerId) {
  // Attach like count, comment count, and whether viewer liked each photo.
  const likeCount = db.prepare('SELECT COUNT(*) n FROM likes WHERE photo_id = ?');
  const commentCount = db.prepare('SELECT COUNT(*) n FROM comments WHERE photo_id = ?');
  const liked = db.prepare('SELECT 1 FROM likes WHERE photo_id = ? AND user_id = ?');
  return photos.map((p) => ({
    ...p,
    likes: likeCount.get(p.id).n,
    comments: commentCount.get(p.id).n,
    likedByMe: viewerId ? !!liked.get(p.id, viewerId) : false,
  }));
}

// ---------------------------------------------------------------------------
// Auth routes
// ---------------------------------------------------------------------------
app.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('register');
});

app.post('/register', (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return res.status(400).render('register', {
      error: 'Username must be 3-20 chars: letters, numbers, underscore.',
    });
  }
  if (password.length < 6) {
    return res.status(400).render('register', {
      error: 'Password must be at least 6 characters.',
    });
  }
  const hash = bcrypt.hashSync(password, 10);
  try {
    const info = db
      .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
      .run(username, hash);
    req.session.userId = info.lastInsertRowid;
    res.redirect('/');
  } catch (e) {
    res.status(400).render('register', { error: 'That username is taken.' });
  }
});

app.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/');
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
  res.redirect('/');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// ---------------------------------------------------------------------------
// Feed (home) — recent photos from people you follow (+ your own)
// ---------------------------------------------------------------------------
app.get('/', (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  const me = req.session.userId;
  const rows = db
    .prepare(`
      SELECT p.*, u.username
        FROM photos p
        JOIN users u ON u.id = p.user_id
       WHERE p.user_id = @me
          OR p.user_id IN (SELECT followee_id FROM follows WHERE follower_id = @me)
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT 100
    `)
    .all({ me });
  res.render('feed', { photos: decorate(rows, me) });
});

// Explore — newest photos from everyone, helps discover people to follow.
app.get('/explore', requireAuth, (req, res) => {
  const rows = db
    .prepare(`
      SELECT p.*, u.username
        FROM photos p JOIN users u ON u.id = p.user_id
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT 100
    `)
    .all();
  res.render('explore', { photos: decorate(rows, req.session.userId) });
});

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------
app.get('/upload', requireAuth, (req, res) => res.render('upload'));

app.post('/upload', requireAuth, upload.single('photo'), (req, res) => {
  if (!req.file) {
    return res.status(400).render('upload', {
      error: 'Please choose an image (jpg, png, gif, webp; max 8 MB).',
    });
  }
  const caption = (req.body.caption || '').trim().slice(0, 500);
  db.prepare('INSERT INTO photos (user_id, filename, caption) VALUES (?, ?, ?)')
    .run(req.session.userId, req.file.filename, caption);
  res.redirect('/');
});

// ---------------------------------------------------------------------------
// Single photo + comments
// ---------------------------------------------------------------------------
app.get('/photos/:id', requireAuth, (req, res) => {
  const photo = db
    .prepare(`
      SELECT p.*, u.username FROM photos p
        JOIN users u ON u.id = p.user_id
       WHERE p.id = ?
    `)
    .get(req.params.id);
  if (!photo) return res.status(404).render('404');
  const [decorated] = decorate([photo], req.session.userId);
  const comments = db
    .prepare(`
      SELECT c.*, u.username FROM comments c
        JOIN users u ON u.id = c.user_id
       WHERE c.photo_id = ?
       ORDER BY c.created_at ASC, c.id ASC
    `)
    .all(photo.id);
  res.render('photo', { photo: decorated, comments });
});

app.post('/photos/:id/comments', requireAuth, (req, res) => {
  const photo = db.prepare('SELECT id FROM photos WHERE id = ?').get(req.params.id);
  const body = (req.body.body || '').trim().slice(0, 1000);
  if (photo && body) {
    db.prepare('INSERT INTO comments (user_id, photo_id, body) VALUES (?, ?, ?)')
      .run(req.session.userId, photo.id, body);
  }
  res.redirect('/photos/' + req.params.id);
});

// Like / unlike (toggle)
app.post('/photos/:id/like', requireAuth, (req, res) => {
  const photo = db.prepare('SELECT id FROM photos WHERE id = ?').get(req.params.id);
  if (photo) {
    const exists = db
      .prepare('SELECT 1 FROM likes WHERE user_id = ? AND photo_id = ?')
      .get(req.session.userId, photo.id);
    if (exists) {
      db.prepare('DELETE FROM likes WHERE user_id = ? AND photo_id = ?')
        .run(req.session.userId, photo.id);
    } else {
      db.prepare('INSERT INTO likes (user_id, photo_id) VALUES (?, ?)')
        .run(req.session.userId, photo.id);
    }
  }
  res.redirect(req.get('referer') || '/');
});

app.post('/photos/:id/delete', requireAuth, (req, res) => {
  const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(req.params.id);
  if (photo && photo.user_id === req.session.userId) {
    db.prepare('DELETE FROM photos WHERE id = ?').run(photo.id);
    fs.unlink(path.join(UPLOAD_DIR, photo.filename), () => {});
  }
  res.redirect('/');
});

// ---------------------------------------------------------------------------
// Profiles + follow
// ---------------------------------------------------------------------------
app.get('/u/:username', requireAuth, (req, res) => {
  const user = db
    .prepare('SELECT id, username, bio, created_at FROM users WHERE username = ?')
    .get(req.params.username);
  if (!user) return res.status(404).render('404');

  const rows = db
    .prepare('SELECT p.*, u.username FROM photos p JOIN users u ON u.id = p.user_id WHERE p.user_id = ? ORDER BY p.created_at DESC, p.id DESC')
    .all(user.id);
  const stats = {
    photos: rows.length,
    followers: db.prepare('SELECT COUNT(*) n FROM follows WHERE followee_id = ?').get(user.id).n,
    following: db.prepare('SELECT COUNT(*) n FROM follows WHERE follower_id = ?').get(user.id).n,
  };
  const isFollowing = !!db
    .prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?')
    .get(req.session.userId, user.id);

  res.render('profile', {
    profile: user,
    photos: decorate(rows, req.session.userId),
    stats,
    isFollowing,
    isMe: user.id === req.session.userId,
  });
});

app.post('/u/:username/follow', requireAuth, (req, res) => {
  const target = db.prepare('SELECT id FROM users WHERE username = ?').get(req.params.username);
  if (target && target.id !== req.session.userId) {
    db.prepare('INSERT OR IGNORE INTO follows (follower_id, followee_id) VALUES (?, ?)')
      .run(req.session.userId, target.id);
  }
  res.redirect('/u/' + req.params.username);
});

app.post('/u/:username/unfollow', requireAuth, (req, res) => {
  const target = db.prepare('SELECT id FROM users WHERE username = ?').get(req.params.username);
  if (target) {
    db.prepare('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?')
      .run(req.session.userId, target.id);
  }
  res.redirect('/u/' + req.params.username);
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------
app.use((req, res) => res.status(404).render('404'));

// Multer / other errors (e.g. file too large)
app.use((err, req, res, next) => {
  console.error(err);
  const msg = err instanceof multer.MulterError ? `Upload failed: ${err.message}` : 'Something went wrong.';
  res.status(400).render('error', { message: msg });
});

app.listen(PORT, () => {
  console.log(`Photo-sharing app running at http://localhost:${PORT}`);
});
