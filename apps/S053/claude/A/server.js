'use strict';

require('dotenv').config();

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const multer = require('multer');

const store = require('./db');

const app = express();
const PORT = process.env.PORT || 5053;

// --- Uploads ---------------------------------------------------------------
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = crypto.randomBytes(12).toString('hex') + ext;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    const ok = /image\/(png|jpe?g|gif|webp|svg\+xml)/.test(file.mimetype);
    cb(ok ? null : new Error('Only image files are allowed.'), ok);
  },
});

// --- App config ------------------------------------------------------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    store: new SQLiteStore({ db: 'sessions.db', dir: path.join(__dirname, 'data') }),
    secret: process.env.SESSION_SECRET || 'dev-only-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }, // 1 week
  })
);

// Make auth state available to every view.
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});

function requireAuth(req, res, next) {
  if (req.session.user) return next();
  return res.redirect('/login');
}

// --- Public routes ---------------------------------------------------------
app.get('/', (req, res) => {
  res.render('index', { projects: store.listProjects() });
});

// --- Auth routes -----------------------------------------------------------
app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/admin');
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = store.findUserByUsername((username || '').trim());

  if (!store.verifyPassword(user, password || '')) {
    return res.status(401).render('login', { error: 'Invalid username or password.' });
  }

  req.session.user = { id: user.id, username: user.username };
  res.redirect('/admin');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// --- Admin routes (owner only) --------------------------------------------
app.get('/admin', requireAuth, (req, res) => {
  res.render('admin', { projects: store.listProjects() });
});

app.get('/admin/projects/new', requireAuth, (req, res) => {
  res.render('project-form', { project: null, action: '/admin/projects', heading: 'New project' });
});

app.post('/admin/projects', requireAuth, upload.single('image'), (req, res) => {
  const { title, description, link } = req.body;
  const image = req.file ? '/uploads/' + req.file.filename : '';
  store.createProject({
    title: (title || '').trim(),
    description: (description || '').trim(),
    link: (link || '').trim(),
    image,
  });
  res.redirect('/admin');
});

app.get('/admin/projects/:id/edit', requireAuth, (req, res) => {
  const project = store.getProject(req.params.id);
  if (!project) return res.status(404).send('Project not found');
  res.render('project-form', {
    project,
    action: `/admin/projects/${project.id}`,
    heading: 'Edit project',
  });
});

// Update (HTML forms can't issue PUT, so we route via POST).
app.post('/admin/projects/:id', requireAuth, upload.single('image'), (req, res) => {
  const project = store.getProject(req.params.id);
  if (!project) return res.status(404).send('Project not found');

  const { title, description, link } = req.body;
  const image = req.file ? '/uploads/' + req.file.filename : project.image;

  store.updateProject(project.id, {
    title: (title || '').trim(),
    description: (description || '').trim(),
    link: (link || '').trim(),
    image,
  });
  res.redirect('/admin');
});

app.post('/admin/projects/:id/delete', requireAuth, (req, res) => {
  store.deleteProject(req.params.id);
  res.redirect('/admin');
});

// --- Error handling --------------------------------------------------------
app.use((err, req, res, next) => {
  console.error(err);
  res.status(400).send(err.message || 'Something went wrong.');
});

app.listen(PORT, () => {
  console.log(`Portfolio site running at http://localhost:${PORT}`);
});
