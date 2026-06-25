require('dotenv').config();

const crypto = require('crypto');
const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');

const PORT = Number(process.env.PORT || 5030);
const SESSION_SECRET = process.env.SESSION_SECRET;
const DATABASE_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'bookmarks.sqlite');
const COOKIE_SECURE = process.env.SESSION_COOKIE_SECURE !== 'false';

if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  console.error('SESSION_SECRET must be set to at least 32 characters.');
  process.exit(1);
}

const app = express();
const db = new Database(DATABASE_PATH);

db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS bookmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_bookmarks_user_id ON bookmarks(user_id);
`);

app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "script-src": ["'self'"],
      "style-src": ["'self'", "'unsafe-inline'"],
      "form-action": ["'self'"],
      "frame-ancestors": ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(session({
  name: 'bm.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: 'strict',
    maxAge: 1000 * 60 * 60 * 2
  }
}));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false
}));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false
});

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function ensureCsrf(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

function csrfProtection(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    return next();
  }

  const sentToken = req.body._csrf;
  if (!sentToken || !req.session.csrfToken) {
    return res.status(403).send(renderPage(req, 'Forbidden', '<p class="error">Invalid request token.</p>'));
  }

  const expected = Buffer.from(req.session.csrfToken);
  const actual = Buffer.from(String(sentToken));
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    return res.status(403).send(renderPage(req, 'Forbidden', '<p class="error">Invalid request token.</p>'));
  }

  return next();
}

app.use(csrfProtection);

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.redirect('/login');
  }
  return next();
}

function currentUser(req) {
  if (!req.session.userId) return null;
  return {
    id: req.session.userId,
    username: req.session.username
  };
}

function validateUsername(username) {
  const value = String(username || '').trim();
  if (!/^[a-zA-Z0-9_-]{3,32}$/.test(value)) {
    return { error: 'Username must be 3-32 characters and use only letters, numbers, underscores, or hyphens.' };
  }
  return { value };
}

function validatePassword(password) {
  const value = String(password || '');
  if (value.length < 12 || value.length > 128) {
    return { error: 'Password must be 12-128 characters.' };
  }
  return { value };
}

function normalizeTags(tags) {
  return [...new Set(String(tags || '')
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
    .filter((tag) => /^[a-z0-9][a-z0-9 _-]{0,29}$/.test(tag))
  )].slice(0, 10).join(', ');
}

function validateBookmark(body) {
  const title = String(body.title || '').trim();
  const rawUrl = String(body.url || '').trim();
  const tags = normalizeTags(body.tags);

  if (title.length < 1 || title.length > 200) {
    return { error: 'Title is required and must be 200 characters or fewer.' };
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { error: 'Enter a valid URL.' };
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    return { error: 'Only http and https URLs are allowed.' };
  }

  if (rawUrl.length > 2048) {
    return { error: 'URL is too long.' };
  }

  return { value: { title, url: url.toString(), tags } };
}

function pageChrome(req, title, body) {
  const user = currentUser(req);
  const csrf = ensureCsrf(req);
  const authNav = user
    ? `<span>Signed in as ${escapeHtml(user.username)}</span>
       <form method="post" action="/logout" class="inline"><input type="hidden" name="_csrf" value="${csrf}"><button>Sign out</button></form>`
    : '<a href="/login">Sign in</a><a href="/register">Register</a>';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} - Bookmark Manager</title>
  <style>
    :root { color-scheme: light; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f5f7fa; color: #17202a; }
    header { background: #10233f; color: white; padding: 18px max(20px, calc((100vw - 980px) / 2)); display: flex; gap: 18px; align-items: center; justify-content: space-between; }
    header a, header span { color: white; text-decoration: none; font-weight: 600; }
    nav { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; }
    main { width: min(980px, calc(100% - 32px)); margin: 28px auto; }
    h1 { font-size: 28px; margin: 0 0 18px; }
    h2 { font-size: 20px; margin: 0 0 12px; }
    .panel, .bookmark { background: white; border: 1px solid #dde3ea; border-radius: 8px; padding: 18px; margin-bottom: 18px; box-shadow: 0 1px 2px rgba(16, 35, 63, .06); }
    label { display: block; font-weight: 700; margin: 12px 0 6px; }
    input { width: 100%; box-sizing: border-box; border: 1px solid #b8c2cc; border-radius: 6px; padding: 10px 12px; font: inherit; }
    button, .button { border: 0; border-radius: 6px; background: #176b87; color: white; padding: 10px 14px; font: inherit; font-weight: 700; cursor: pointer; text-decoration: none; display: inline-block; }
    .danger { background: #a63d40; }
    .muted { color: #5c6b7a; }
    .error { background: #fdecee; color: #7f1d1d; border: 1px solid #f2b8c0; border-radius: 6px; padding: 10px 12px; }
    .success { background: #edf8f1; color: #14532d; border: 1px solid #bbdfc8; border-radius: 6px; padding: 10px 12px; }
    .row { display: flex; gap: 10px; align-items: end; flex-wrap: wrap; }
    .row > * { flex: 1 1 220px; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
    .inline { display: inline; }
    .inline button { padding: 8px 10px; }
    .tag { display: inline-block; background: #e7eef6; color: #20344d; border-radius: 999px; padding: 3px 8px; margin: 4px 5px 0 0; font-size: 13px; text-decoration: none; }
    a { color: #176b87; }
  </style>
</head>
<body>
  <header>
    <a href="/">Bookmark Manager</a>
    <nav>${authNav}</nav>
  </header>
  <main>${body}</main>
</body>
</html>`;
}

function renderPage(req, title, body) {
  return pageChrome(req, title, body);
}

function bookmarkForm(req, bookmark = {}, action = '/bookmarks', button = 'Save bookmark') {
  const csrf = ensureCsrf(req);
  return `<form method="post" action="${escapeHtml(action)}" class="panel">
    <input type="hidden" name="_csrf" value="${csrf}">
    <div class="row">
      <div>
        <label for="title">Title</label>
        <input id="title" name="title" maxlength="200" required value="${escapeHtml(bookmark.title || '')}">
      </div>
      <div>
        <label for="url">URL</label>
        <input id="url" name="url" type="url" maxlength="2048" required value="${escapeHtml(bookmark.url || '')}">
      </div>
    </div>
    <label for="tags">Tags</label>
    <input id="tags" name="tags" maxlength="320" placeholder="work, reading, tools" value="${escapeHtml(bookmark.tags || '')}">
    <div class="actions"><button>${escapeHtml(button)}</button></div>
  </form>`;
}

function bookmarkList(req, bookmarks) {
  const csrf = ensureCsrf(req);
  if (bookmarks.length === 0) {
    return '<p class="panel muted">No bookmarks found.</p>';
  }

  return bookmarks.map((bookmark) => {
    const tags = bookmark.tags
      ? bookmark.tags.split(',').map((tag) => {
        const cleanTag = tag.trim();
        return `<a class="tag" href="/?tag=${encodeURIComponent(cleanTag)}">${escapeHtml(cleanTag)}</a>`;
      }).join('')
      : '<span class="muted">No tags</span>';

    return `<article class="bookmark">
      <h2><a href="${escapeHtml(bookmark.url)}" rel="noopener noreferrer">${escapeHtml(bookmark.title)}</a></h2>
      <p class="muted">${escapeHtml(bookmark.url)}</p>
      <div>${tags}</div>
      <div class="actions">
        <a class="button" href="/bookmarks/${bookmark.id}/edit">Edit</a>
        <form method="post" action="/bookmarks/${bookmark.id}/delete" class="inline">
          <input type="hidden" name="_csrf" value="${csrf}">
          <button class="danger" onclick="return confirm('Delete this bookmark?')">Delete</button>
        </form>
      </div>
    </article>`;
  }).join('');
}

app.get('/', requireAuth, (req, res) => {
  const requestedTag = String(req.query.tag || '').trim().toLowerCase();
  const tag = /^[a-z0-9][a-z0-9 _-]{0,29}$/.test(requestedTag) ? requestedTag : '';
  let bookmarks;

  if (tag) {
    bookmarks = db.prepare(`
      SELECT id, title, url, tags, created_at, updated_at
      FROM bookmarks
      WHERE user_id = ? AND (',' || replace(lower(tags), ', ', ',') || ',') LIKE ?
      ORDER BY updated_at DESC, id DESC
    `).all(req.session.userId, `%,${tag},%`);
  } else {
    bookmarks = db.prepare(`
      SELECT id, title, url, tags, created_at, updated_at
      FROM bookmarks
      WHERE user_id = ?
      ORDER BY updated_at DESC, id DESC
    `).all(req.session.userId);
  }

  const filter = tag ? `<p class="success">Filtered by tag: ${escapeHtml(tag)} <a href="/">Clear</a></p>` : '';
  res.send(renderPage(req, 'Your bookmarks', `
    <h1>Your bookmarks</h1>
    ${filter}
    ${bookmarkForm(req)}
    ${bookmarkList(req, bookmarks)}
  `));
});

app.get('/register', (req, res) => {
  const csrf = ensureCsrf(req);
  res.send(renderPage(req, 'Register', `
    <h1>Create account</h1>
    <form method="post" action="/register" class="panel">
      <input type="hidden" name="_csrf" value="${csrf}">
      <label for="username">Username</label>
      <input id="username" name="username" autocomplete="username" required>
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="new-password" required>
      <div class="actions"><button>Create account</button></div>
    </form>
  `));
});

app.post('/register', authLimiter, async (req, res) => {
  const username = validateUsername(req.body.username);
  const password = validatePassword(req.body.password);

  if (username.error || password.error) {
    return res.status(400).send(renderPage(req, 'Register', `<p class="error">${escapeHtml(username.error || password.error)}</p>`));
  }

  try {
    const passwordHash = await bcrypt.hash(password.value, 12);
    const result = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username.value, passwordHash);
    req.session.regenerate((err) => {
      if (err) return res.status(500).send(renderPage(req, 'Error', '<p class="error">Unable to sign in.</p>'));
      req.session.userId = result.lastInsertRowid;
      req.session.username = username.value;
      ensureCsrf(req);
      return res.redirect('/');
    });
  } catch (error) {
    if (String(error.message || '').includes('UNIQUE')) {
      return res.status(409).send(renderPage(req, 'Register', '<p class="error">That username is already taken.</p>'));
    }
    return res.status(500).send(renderPage(req, 'Error', '<p class="error">Unable to create account.</p>'));
  }
});

app.get('/login', (req, res) => {
  const csrf = ensureCsrf(req);
  res.send(renderPage(req, 'Sign in', `
    <h1>Sign in</h1>
    <form method="post" action="/login" class="panel">
      <input type="hidden" name="_csrf" value="${csrf}">
      <label for="username">Username</label>
      <input id="username" name="username" autocomplete="username" required>
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <div class="actions"><button>Sign in</button></div>
    </form>
  `));
});

app.post('/login', authLimiter, async (req, res) => {
  const username = validateUsername(req.body.username);
  const password = String(req.body.password || '');

  if (username.error || !password) {
    return res.status(400).send(renderPage(req, 'Sign in', '<p class="error">Invalid username or password.</p>'));
  }

  const user = db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username.value);
  const valid = user ? await bcrypt.compare(password, user.password_hash) : false;

  if (!valid) {
    return res.status(401).send(renderPage(req, 'Sign in', '<p class="error">Invalid username or password.</p>'));
  }

  req.session.regenerate((err) => {
    if (err) return res.status(500).send(renderPage(req, 'Error', '<p class="error">Unable to sign in.</p>'));
    req.session.userId = user.id;
    req.session.username = user.username;
    ensureCsrf(req);
    return res.redirect('/');
  });
});

app.post('/logout', requireAuth, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('bm.sid');
    res.redirect('/login');
  });
});

app.post('/bookmarks', requireAuth, (req, res) => {
  const bookmark = validateBookmark(req.body);
  if (bookmark.error) {
    return res.status(400).send(renderPage(req, 'Your bookmarks', `<p class="error">${escapeHtml(bookmark.error)}</p>${bookmarkForm(req, req.body)}`));
  }

  db.prepare('INSERT INTO bookmarks (user_id, title, url, tags) VALUES (?, ?, ?, ?)')
    .run(req.session.userId, bookmark.value.title, bookmark.value.url, bookmark.value.tags);
  res.redirect('/');
});

app.get('/bookmarks/:id/edit', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) {
    return res.status(404).send(renderPage(req, 'Not found', '<p class="error">Bookmark not found.</p>'));
  }

  const bookmark = db.prepare('SELECT id, title, url, tags FROM bookmarks WHERE id = ? AND user_id = ?')
    .get(id, req.session.userId);
  if (!bookmark) {
    return res.status(404).send(renderPage(req, 'Not found', '<p class="error">Bookmark not found.</p>'));
  }

  res.send(renderPage(req, 'Edit bookmark', `
    <h1>Edit bookmark</h1>
    ${bookmarkForm(req, bookmark, `/bookmarks/${bookmark.id}/edit`, 'Update bookmark')}
  `));
});

app.post('/bookmarks/:id/edit', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) {
    return res.status(404).send(renderPage(req, 'Not found', '<p class="error">Bookmark not found.</p>'));
  }

  const bookmark = validateBookmark(req.body);
  if (bookmark.error) {
    return res.status(400).send(renderPage(req, 'Edit bookmark', `<p class="error">${escapeHtml(bookmark.error)}</p>${bookmarkForm(req, { ...req.body, id }, `/bookmarks/${id}/edit`, 'Update bookmark')}`));
  }

  const result = db.prepare(`
    UPDATE bookmarks
    SET title = ?, url = ?, tags = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ?
  `).run(bookmark.value.title, bookmark.value.url, bookmark.value.tags, id, req.session.userId);

  if (result.changes === 0) {
    return res.status(404).send(renderPage(req, 'Not found', '<p class="error">Bookmark not found.</p>'));
  }

  res.redirect('/');
});

app.post('/bookmarks/:id/delete', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) {
    return res.status(404).send(renderPage(req, 'Not found', '<p class="error">Bookmark not found.</p>'));
  }

  const result = db.prepare('DELETE FROM bookmarks WHERE id = ? AND user_id = ?').run(id, req.session.userId);
  if (result.changes === 0) {
    return res.status(404).send(renderPage(req, 'Not found', '<p class="error">Bookmark not found.</p>'));
  }

  res.redirect('/');
});

app.use((req, res) => {
  res.status(404).send(renderPage(req, 'Not found', '<p class="error">Page not found.</p>'));
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).send(renderPage(req, 'Error', '<p class="error">Something went wrong.</p>'));
});

app.listen(PORT, () => {
  console.log(`Bookmark manager listening on port ${PORT}`);
});
