'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);

const { users, faqs } = require('./db');

const app = express();
const PORT = process.env.PORT || 5041;

// --- View engine & middleware --------------------------------------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    store: new SQLiteStore({ db: 'sessions.db', dir: path.join(__dirname, 'data') }),
    secret: process.env.SESSION_SECRET || 'dev-insecure-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 8 }, // 8 hours
  })
);

// Expose the current user to all templates.
app.use((req, res, next) => {
  res.locals.currentUser = req.session.username || null;
  next();
});

function requireEditor(req, res, next) {
  if (req.session.userId) return next();
  return res.redirect('/login');
}

// --- Public FAQ page ------------------------------------------------------
app.get('/', (req, res) => {
  const q = (req.query.q || '').trim();
  const needle = q.toLowerCase();

  const all = faqs.all();
  const filtered = needle
    ? all.filter(
        (f) =>
          f.question.toLowerCase().includes(needle) ||
          f.answer.toLowerCase().includes(needle) ||
          f.category.toLowerCase().includes(needle)
      )
    : all;

  // Group by category, preserving the ordering produced by the query.
  const grouped = [];
  const indexByCategory = new Map();
  for (const item of filtered) {
    if (!indexByCategory.has(item.category)) {
      indexByCategory.set(item.category, grouped.length);
      grouped.push({ category: item.category, items: [] });
    }
    grouped[indexByCategory.get(item.category)].items.push(item);
  }

  res.render('public', { grouped, q, total: filtered.length });
});

// --- Authentication -------------------------------------------------------
app.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/admin');
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = users.findByUsername((username || '').trim());

  if (!users.verify(user, password || '')) {
    return res.status(401).render('login', { error: 'Invalid username or password.' });
  }

  req.session.userId = user.id;
  req.session.username = user.username;
  res.redirect('/admin');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// --- Editor admin panel ---------------------------------------------------
app.get('/admin', requireEditor, (req, res) => {
  const grouped = [];
  const indexByCategory = new Map();
  for (const item of faqs.all()) {
    if (!indexByCategory.has(item.category)) {
      indexByCategory.set(item.category, grouped.length);
      grouped.push({ category: item.category, items: [] });
    }
    grouped[indexByCategory.get(item.category)].items.push(item);
  }

  const editId = req.query.edit ? Number(req.query.edit) : null;
  const editing = editId ? faqs.get(editId) : null;

  res.render('admin', {
    grouped,
    editing,
    categories: faqs.categories(),
  });
});

app.post('/admin/faqs', requireEditor, (req, res) => {
  const category = (req.body.category || '').trim();
  const question = (req.body.question || '').trim();
  const answer = (req.body.answer || '').trim();

  if (category && question && answer) {
    faqs.create({ category, question, answer });
  }
  res.redirect('/admin');
});

app.post('/admin/faqs/:id/edit', requireEditor, (req, res) => {
  const id = Number(req.params.id);
  const category = (req.body.category || '').trim();
  const question = (req.body.question || '').trim();
  const answer = (req.body.answer || '').trim();

  if (category && question && answer) {
    faqs.update(id, { category, question, answer });
  }
  res.redirect('/admin');
});

app.post('/admin/faqs/:id/delete', requireEditor, (req, res) => {
  faqs.remove(Number(req.params.id));
  res.redirect('/admin');
});

app.post('/admin/faqs/:id/move', requireEditor, (req, res) => {
  const direction = req.body.direction === 'up' ? 'up' : 'down';
  faqs.move(Number(req.params.id), direction);
  res.redirect('/admin');
});

// --- 404 ------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).send('Not found');
});

app.listen(PORT, () => {
  console.log(`FAQ app running at http://localhost:${PORT}`);
});
