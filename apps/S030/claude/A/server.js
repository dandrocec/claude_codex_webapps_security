'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const bcrypt = require('bcryptjs');

const db = require('./db');

const app = express();
const PORT = process.env.PORT || 5030;

// ---------------------------------------------------------------------------
// View engine & middleware
// ---------------------------------------------------------------------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'change-me-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }, // 1 week
  })
);

app.use(flash());

// Expose the current user and flash messages to every template.
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  next();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Normalise free-text tags into a clean, de-duplicated, lower-cased list.
function parseTags(raw) {
  if (!raw) return [];
  return [
    ...new Set(
      String(raw)
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
    ),
  ];
}

function tagsToString(tagArray) {
  return tagArray.join(',');
}

function tagsToArray(tagString) {
  return tagString ? tagString.split(',').filter(Boolean) : [];
}

// Guard for routes that require a logged-in user.
function requireAuth(req, res, next) {
  if (!req.session.user) {
    req.flash('error', 'Please log in to continue.');
    return res.redirect('/login');
  }
  next();
}

// ---------------------------------------------------------------------------
// Auth routes
// ---------------------------------------------------------------------------
app.get('/register', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('register');
});

app.post('/register', (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';

  if (username.length < 3 || password.length < 6) {
    req.flash(
      'error',
      'Username must be at least 3 characters and password at least 6.'
    );
    return res.redirect('/register');
  }

  const existing = db
    .prepare('SELECT id FROM users WHERE username = ?')
    .get(username);
  if (existing) {
    req.flash('error', 'That username is already taken.');
    return res.redirect('/register');
  }

  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .run(username, hash);

  req.session.user = { id: info.lastInsertRowid, username };
  req.flash('success', `Welcome, ${username}!`);
  res.redirect('/');
});

app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login');
});

app.post('/login', (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';

  const user = db
    .prepare('SELECT * FROM users WHERE username = ?')
    .get(username);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    req.flash('error', 'Invalid username or password.');
    return res.redirect('/login');
  }

  req.session.user = { id: user.id, username: user.username };
  req.flash('success', `Welcome back, ${user.username}!`);
  res.redirect('/');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// ---------------------------------------------------------------------------
// Bookmark routes (all scoped to the logged-in user)
// ---------------------------------------------------------------------------

// List + optional tag filter.
app.get('/', requireAuth, (req, res) => {
  const userId = req.session.user.id;
  const activeTag = (req.query.tag || '').trim().toLowerCase();

  const rows = db
    .prepare('SELECT * FROM bookmarks WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId);

  const bookmarks = rows
    .map((b) => ({ ...b, tagList: tagsToArray(b.tags) }))
    .filter((b) => !activeTag || b.tagList.includes(activeTag));

  // Build the set of all tags this user has, for the filter sidebar.
  const allTags = [
    ...new Set(rows.flatMap((b) => tagsToArray(b.tags))),
  ].sort();

  res.render('index', { bookmarks, allTags, activeTag });
});

app.get('/bookmarks/new', requireAuth, (req, res) => {
  res.render('form', { mode: 'create', bookmark: null });
});

app.post('/bookmarks', requireAuth, (req, res) => {
  const title = (req.body.title || '').trim();
  let url = (req.body.url || '').trim();
  const tags = tagsToString(parseTags(req.body.tags));

  if (!title || !url) {
    req.flash('error', 'Title and URL are required.');
    return res.redirect('/bookmarks/new');
  }

  // Be forgiving about a missing scheme.
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  db.prepare(
    'INSERT INTO bookmarks (user_id, title, url, tags) VALUES (?, ?, ?, ?)'
  ).run(req.session.user.id, title, url, tags);

  req.flash('success', 'Bookmark saved.');
  res.redirect('/');
});

// Fetch a bookmark the current user owns, or null.
function getOwnedBookmark(id, userId) {
  return db
    .prepare('SELECT * FROM bookmarks WHERE id = ? AND user_id = ?')
    .get(id, userId);
}

app.get('/bookmarks/:id/edit', requireAuth, (req, res) => {
  const bookmark = getOwnedBookmark(req.params.id, req.session.user.id);
  if (!bookmark) {
    req.flash('error', 'Bookmark not found.');
    return res.redirect('/');
  }
  res.render('form', { mode: 'edit', bookmark });
});

app.post('/bookmarks/:id', requireAuth, (req, res) => {
  const bookmark = getOwnedBookmark(req.params.id, req.session.user.id);
  if (!bookmark) {
    req.flash('error', 'Bookmark not found.');
    return res.redirect('/');
  }

  const title = (req.body.title || '').trim();
  let url = (req.body.url || '').trim();
  const tags = tagsToString(parseTags(req.body.tags));

  if (!title || !url) {
    req.flash('error', 'Title and URL are required.');
    return res.redirect(`/bookmarks/${bookmark.id}/edit`);
  }
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  db.prepare(
    'UPDATE bookmarks SET title = ?, url = ?, tags = ? WHERE id = ? AND user_id = ?'
  ).run(title, url, tags, bookmark.id, req.session.user.id);

  req.flash('success', 'Bookmark updated.');
  res.redirect('/');
});

app.post('/bookmarks/:id/delete', requireAuth, (req, res) => {
  db.prepare('DELETE FROM bookmarks WHERE id = ? AND user_id = ?').run(
    req.params.id,
    req.session.user.id
  );
  req.flash('success', 'Bookmark deleted.');
  res.redirect('/');
});

// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Bookmark manager running at http://localhost:${PORT}`);
});
