const path = require('path');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 5030;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'bookmarks.db');

const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  db.run('PRAGMA foreign_keys = ON');
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS bookmarks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: false }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'replace-this-secret-for-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax'
    }
  })
);

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.error = null;
  next();
});

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    res.redirect('/login');
    return;
  }
  next();
}

function normalizeTags(tags) {
  return tags
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
    .filter((tag, index, list) => list.indexOf(tag) === index)
    .join(', ');
}

function tagsForDisplay(tags) {
  return tags ? tags.split(',').map((tag) => tag.trim()).filter(Boolean) : [];
}

function normalizeUrl(url) {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

app.get('/', (req, res) => {
  res.redirect(req.session.user ? '/bookmarks' : '/login');
});

app.get('/register', (req, res) => {
  res.render('auth', {
    mode: 'register',
    title: 'Create account',
    action: '/register'
  });
});

app.post('/register', async (req, res, next) => {
  try {
    const username = req.body.username.trim();
    const password = req.body.password;

    if (!username || !password || password.length < 6) {
      res.status(400).render('auth', {
        mode: 'register',
        title: 'Create account',
        action: '/register',
        error: 'Use a username and a password with at least 6 characters.'
      });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const result = await run(
      'INSERT INTO users (username, password_hash) VALUES (?, ?)',
      [username, passwordHash]
    );
    req.session.user = { id: result.lastID, username };
    res.redirect('/bookmarks');
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT') {
      res.status(409).render('auth', {
        mode: 'register',
        title: 'Create account',
        action: '/register',
        error: 'That username is already taken.'
      });
      return;
    }
    next(err);
  }
});

app.get('/login', (req, res) => {
  res.render('auth', {
    mode: 'login',
    title: 'Sign in',
    action: '/login'
  });
});

app.post('/login', async (req, res, next) => {
  try {
    const username = req.body.username.trim();
    const password = req.body.password;
    const user = await get('SELECT * FROM users WHERE username = ?', [username]);

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      res.status(401).render('auth', {
        mode: 'login',
        title: 'Sign in',
        action: '/login',
        error: 'Invalid username or password.'
      });
      return;
    }

    req.session.user = { id: user.id, username: user.username };
    res.redirect('/bookmarks');
  } catch (err) {
    next(err);
  }
});

app.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) {
      next(err);
      return;
    }
    res.redirect('/login');
  });
});

app.get('/bookmarks', requireAuth, async (req, res, next) => {
  try {
    const selectedTag = (req.query.tag || '').trim().toLowerCase();
    const bookmarks = await all(
      `SELECT * FROM bookmarks
       WHERE user_id = ?
       ORDER BY updated_at DESC, created_at DESC`,
      [req.session.user.id]
    );

    const enriched = bookmarks.map((bookmark) => ({
      ...bookmark,
      tagList: tagsForDisplay(bookmark.tags)
    }));
    const filtered = selectedTag
      ? enriched.filter((bookmark) => bookmark.tagList.includes(selectedTag))
      : enriched;
    const tags = [...new Set(enriched.flatMap((bookmark) => bookmark.tagList))].sort();

    res.render('bookmarks', {
      bookmarks: filtered,
      tags,
      selectedTag
    });
  } catch (err) {
    next(err);
  }
});

app.post('/bookmarks', requireAuth, async (req, res, next) => {
  try {
    const title = req.body.title.trim();
    const url = normalizeUrl(req.body.url);
    const tags = normalizeTags(req.body.tags || '');

    if (!title || !url) {
      res.status(400).render('bookmark-form', {
        heading: 'New bookmark',
        action: '/bookmarks',
        bookmark: { title, url, tags },
        error: 'Title and URL are required.'
      });
      return;
    }

    await run(
      'INSERT INTO bookmarks (user_id, title, url, tags) VALUES (?, ?, ?, ?)',
      [req.session.user.id, title, url, tags]
    );
    res.redirect('/bookmarks');
  } catch (err) {
    next(err);
  }
});

app.get('/bookmarks/new', requireAuth, (req, res) => {
  res.render('bookmark-form', {
    heading: 'New bookmark',
    action: '/bookmarks',
    bookmark: { title: '', url: '', tags: '' }
  });
});

app.get('/bookmarks/:id/edit', requireAuth, async (req, res, next) => {
  try {
    const bookmark = await get(
      'SELECT * FROM bookmarks WHERE id = ? AND user_id = ?',
      [req.params.id, req.session.user.id]
    );
    if (!bookmark) {
      res.status(404).render('error', { message: 'Bookmark not found.' });
      return;
    }

    res.render('bookmark-form', {
      heading: 'Edit bookmark',
      action: `/bookmarks/${bookmark.id}`,
      bookmark
    });
  } catch (err) {
    next(err);
  }
});

app.post('/bookmarks/:id', requireAuth, async (req, res, next) => {
  try {
    const title = req.body.title.trim();
    const url = normalizeUrl(req.body.url);
    const tags = normalizeTags(req.body.tags || '');

    if (!title || !url) {
      res.status(400).render('bookmark-form', {
        heading: 'Edit bookmark',
        action: `/bookmarks/${req.params.id}`,
        bookmark: { id: req.params.id, title, url, tags },
        error: 'Title and URL are required.'
      });
      return;
    }

    const result = await run(
      `UPDATE bookmarks
       SET title = ?, url = ?, tags = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
      [title, url, tags, req.params.id, req.session.user.id]
    );
    if (result.changes === 0) {
      res.status(404).render('error', { message: 'Bookmark not found.' });
      return;
    }
    res.redirect('/bookmarks');
  } catch (err) {
    next(err);
  }
});

app.post('/bookmarks/:id/delete', requireAuth, async (req, res, next) => {
  try {
    await run('DELETE FROM bookmarks WHERE id = ? AND user_id = ?', [
      req.params.id,
      req.session.user.id
    ]);
    res.redirect('/bookmarks');
  } catch (err) {
    next(err);
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { message: 'Something went wrong.' });
});

app.listen(PORT, () => {
  console.log(`Bookmark manager running on http://localhost:${PORT}`);
});
