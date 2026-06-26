const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');
const csrf = require('csurf');
const helmet = require('helmet');
const multer = require('multer');
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');
const rateLimit = require('express-rate-limit');

const PORT = Number(process.env.PORT || 5082);
const SESSION_SECRET = process.env.SESSION_SECRET;
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const DB_PATH = path.resolve(process.env.DATABASE_PATH || path.join(DATA_DIR, 'app.db'));
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(DATA_DIR, 'uploads'));
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 5 * 1024 * 1024);
const BCRYPT_ROUNDS = 12;

if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  console.error('SESSION_SECRET must be set to at least 32 characters.');
  process.exit(1);
}

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS shares (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    token TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_at TEXT,
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'"],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"]
    }
  },
  referrerPolicy: { policy: 'no-referrer' }
}));

app.use(express.urlencoded({ extended: false, limit: '32kb' }));
app.use(session({
  name: 'sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' || process.env.SECURE_COOKIES === 'true',
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 2
  }
}));

const csrfProtection = csrf();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false
});

const allowedTypes = new Map([
  ['image/png', { ext: '.png', magic: ['89504e470d0a1a0a'] }],
  ['image/jpeg', { ext: '.jpg', magic: ['ffd8ff'] }],
  ['application/pdf', { ext: '.pdf', magic: ['25504446'] }],
  ['text/plain', { ext: '.txt', text: true }],
  ['text/csv', { ext: '.csv', text: true }]
]);

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function validatePassword(password) {
  return typeof password === 'string' && password.length >= 12 && password.length <= 128;
}

function sanitizeFilename(name) {
  const base = path.basename(String(name || 'file')).replace(/[^\w.\- ]+/g, '_').trim();
  return base.slice(0, 120) || 'file';
}

function safeStoredPath(storedName) {
  if (!/^[a-f0-9]{64}\.[a-z0-9]+$/.test(storedName)) {
    throw new Error('Invalid stored filename');
  }
  const resolved = path.resolve(UPLOAD_DIR, storedName);
  const prefix = UPLOAD_DIR.endsWith(path.sep) ? UPLOAD_DIR : UPLOAD_DIR + path.sep;
  if (!resolved.startsWith(prefix)) {
    throw new Error('Invalid file path');
  }
  return resolved;
}

function isUtf8Text(buffer) {
  if (buffer.includes(0)) return false;
  const text = buffer.toString('utf8');
  return Buffer.from(text, 'utf8').equals(buffer);
}

function looksLikeCsv(buffer) {
  const text = buffer.toString('utf8').trim();
  const lines = text.split(/\r?\n/).filter(Boolean).slice(0, 10);
  if (lines.length === 0) return false;
  const commaCounts = lines.map((line) => (line.match(/,/g) || []).length);
  return commaCounts[0] > 0 && commaCounts.every((count) => count === commaCounts[0]);
}

async function inspectUpload(buffer) {
  const { fileTypeFromBuffer } = await import('file-type');
  const detected = await fileTypeFromBuffer(buffer);
  if (detected && allowedTypes.has(detected.mime)) {
    return { mime: detected.mime, ext: allowedTypes.get(detected.mime).ext };
  }

  if (isUtf8Text(buffer)) {
    return looksLikeCsv(buffer)
      ? { mime: 'text/csv', ext: '.csv' }
      : { mime: 'text/plain', ext: '.txt' };
  }
  return null;
}

function renderPage(req, title, body, status = 200) {
  const currentUser = req.session.user;
  const nav = currentUser
    ? `<a href="/dashboard">Files</a><form method="post" action="/logout"><input type="hidden" name="_csrf" value="${escapeHtml(req.csrfToken())}"><button type="submit">Sign out</button></form>`
    : '<a href="/login">Sign in</a><a href="/register">Register</a>';

  return req.res.status(status).type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <header><a class="brand" href="/">File Storage</a><nav>${nav}</nav></header>
  <main>${body}</main>
</body>
</html>`);
}

function flash(req) {
  const message = req.session.flash;
  delete req.session.flash;
  return message ? `<p class="notice">${escapeHtml(message)}</p>` : '';
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  return next();
}

app.get('/styles.css', (req, res) => {
  res.type('css').send(`
body{margin:0;font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f6f7f9;color:#1f2933}
header{display:flex;align-items:center;justify-content:space-between;padding:16px 24px;background:#fff;border-bottom:1px solid #d9dee7}
main{max-width:980px;margin:0 auto;padding:28px 20px}
a{color:#075985} .brand{font-weight:700;text-decoration:none;color:#111827}
nav{display:flex;gap:14px;align-items:center} nav form{margin:0}
.panel,.file{background:#fff;border:1px solid #d9dee7;border-radius:8px;padding:18px;margin-bottom:16px}
label{display:block;margin:12px 0 6px;font-weight:600}
input[type=email],input[type=password],input[type=file]{width:100%;box-sizing:border-box;padding:10px;border:1px solid #b8c2d1;border-radius:6px;background:#fff}
button,.button{display:inline-block;border:0;border-radius:6px;background:#0f766e;color:#fff;padding:9px 13px;text-decoration:none;cursor:pointer;font-weight:600}
button.danger{background:#b91c1c}.muted{color:#52616f}.notice{background:#ecfdf5;border:1px solid #a7f3d0;border-radius:6px;padding:10px}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.shares{margin-top:12px;padding-left:18px}
code{word-break:break-all;background:#eef2f7;padding:2px 4px;border-radius:4px}
`);
});

app.get('/', csrfProtection, (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  return renderPage(req, 'File Storage', `
    <section class="panel">
      <h1>Personal file storage</h1>
      <p class="muted">Upload allowed files, download your own files, and create revocable read-only share links.</p>
      <p><a class="button" href="/register">Create account</a> <a href="/login">Sign in</a></p>
    </section>
  `);
});

app.get('/register', csrfProtection, (req, res) => {
  return renderPage(req, 'Register', `
    <section class="panel">
      <h1>Create account</h1>${flash(req)}
      <form method="post" action="/register">
        <input type="hidden" name="_csrf" value="${escapeHtml(req.csrfToken())}">
        <label>Email</label><input name="email" type="email" maxlength="254" required>
        <label>Password</label><input name="password" type="password" minlength="12" maxlength="128" required>
        <p><button type="submit">Register</button></p>
      </form>
    </section>
  `);
});

app.post('/register', authLimiter, csrfProtection, async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || '');
  if (!validateEmail(email) || !validatePassword(password)) {
    req.session.flash = 'Use a valid email and a password between 12 and 128 characters.';
    return res.redirect('/register');
  }

  try {
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const result = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(email, passwordHash);
    req.session.regenerate((err) => {
      if (err) throw err;
      req.session.user = { id: result.lastInsertRowid, email };
      res.redirect('/dashboard');
    });
  } catch (err) {
    req.session.flash = 'Account could not be created.';
    return res.redirect('/register');
  }
});

app.get('/login', csrfProtection, (req, res) => {
  return renderPage(req, 'Sign in', `
    <section class="panel">
      <h1>Sign in</h1>${flash(req)}
      <form method="post" action="/login">
        <input type="hidden" name="_csrf" value="${escapeHtml(req.csrfToken())}">
        <label>Email</label><input name="email" type="email" maxlength="254" required>
        <label>Password</label><input name="password" type="password" maxlength="128" required>
        <p><button type="submit">Sign in</button></p>
      </form>
    </section>
  `);
});

app.post('/login', authLimiter, csrfProtection, async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || '');
  const user = validateEmail(email)
    ? db.prepare('SELECT id, email, password_hash FROM users WHERE email = ?').get(email)
    : null;
  const ok = user ? await bcrypt.compare(password, user.password_hash) : false;
  if (!ok) {
    req.session.flash = 'Invalid email or password.';
    return res.redirect('/login');
  }

  req.session.regenerate((err) => {
    if (err) throw err;
    req.session.user = { id: user.id, email: user.email };
    res.redirect('/dashboard');
  });
});

app.post('/logout', csrfProtection, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('sid');
    res.redirect('/');
  });
});

app.get('/dashboard', csrfProtection, requireAuth, (req, res) => {
  const files = db.prepare('SELECT * FROM files WHERE user_id = ? ORDER BY created_at DESC').all(req.session.user.id);
  const shares = db.prepare(`
    SELECT shares.*, files.original_name
    FROM shares
    JOIN files ON files.id = shares.file_id
    WHERE shares.user_id = ?
    ORDER BY shares.created_at DESC
  `).all(req.session.user.id);
  const sharesByFile = new Map();
  for (const share of shares) {
    if (!sharesByFile.has(share.file_id)) sharesByFile.set(share.file_id, []);
    sharesByFile.get(share.file_id).push(share);
  }

  const fileHtml = files.map((file) => {
    const fileShares = sharesByFile.get(file.id) || [];
    const shareItems = fileShares.length
      ? `<ul class="shares">${fileShares.map((share) => {
          const url = `${req.protocol}://${req.get('host')}/s/${share.token}`;
          const revoked = share.revoked_at ? ` <span class="muted">(revoked)</span>` : '';
          const revoke = share.revoked_at ? '' : `<form method="post" action="/shares/${share.id}/revoke"><input type="hidden" name="_csrf" value="${escapeHtml(req.csrfToken())}"><button class="danger" type="submit">Revoke</button></form>`;
          return `<li><code>${escapeHtml(url)}</code>${revoked} ${revoke}</li>`;
        }).join('')}</ul>`
      : '<p class="muted">No share links.</p>';

    return `<article class="file">
      <h2>${escapeHtml(file.original_name)}</h2>
      <p class="muted">${escapeHtml(file.mime_type)} · ${Number(file.size)} bytes · ${escapeHtml(file.created_at)}</p>
      <div class="row">
        <a class="button" href="/files/${file.id}/download">Download</a>
        <form method="post" action="/files/${file.id}/shares"><input type="hidden" name="_csrf" value="${escapeHtml(req.csrfToken())}"><button type="submit">Create share link</button></form>
        <form method="post" action="/files/${file.id}/delete"><input type="hidden" name="_csrf" value="${escapeHtml(req.csrfToken())}"><button class="danger" type="submit">Delete</button></form>
      </div>
      ${shareItems}
    </article>`;
  }).join('');

  return renderPage(req, 'Your files', `
    <section class="panel">
      <h1>Your files</h1>${flash(req)}
      <form method="post" action="/files/upload?_csrf=${encodeURIComponent(req.csrfToken())}" enctype="multipart/form-data">
        <label>Upload file</label>
        <input name="file" type="file" required>
        <p class="muted">Allowed: PNG, JPEG, PDF, TXT, CSV. Maximum ${MAX_UPLOAD_BYTES} bytes.</p>
        <button type="submit">Upload</button>
      </form>
    </section>
    ${fileHtml || '<section class="panel"><p class="muted">No files uploaded yet.</p></section>'}
  `);
});

app.post('/files/upload', csrfProtection, requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
    req.session.flash = 'Choose a non-empty file to upload.';
    return res.redirect('/dashboard');
  }
  const inspected = await inspectUpload(req.file.buffer);
  if (!inspected) {
    req.session.flash = 'Unsupported file type.';
    return res.redirect('/dashboard');
  }

  const storedName = `${crypto.randomBytes(32).toString('hex')}${inspected.ext}`;
  const destination = safeStoredPath(storedName);
  fs.writeFileSync(destination, req.file.buffer, { flag: 'wx', mode: 0o600 });
  db.prepare(`
    INSERT INTO files (user_id, original_name, stored_name, mime_type, size)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.session.user.id, sanitizeFilename(req.file.originalname), storedName, inspected.mime, req.file.size);
  req.session.flash = 'File uploaded.';
  return res.redirect('/dashboard');
});

app.get('/files/:id/download', requireAuth, (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id)) return res.status(404).send('Not found');
  const file = db.prepare('SELECT * FROM files WHERE id = ? AND user_id = ?').get(id, req.session.user.id);
  if (!file) return res.status(404).send('Not found');
  try {
    const filePath = safeStoredPath(file.stored_name);
    res.download(filePath, file.original_name, { headers: { 'Content-Type': file.mime_type } });
  } catch (err) {
    next(err);
  }
});

app.post('/files/:id/shares', csrfProtection, requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id)) return res.status(404).send('Not found');
  const file = db.prepare('SELECT id FROM files WHERE id = ? AND user_id = ?').get(id, req.session.user.id);
  if (!file) return res.status(404).send('Not found');
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO shares (file_id, user_id, token) VALUES (?, ?, ?)').run(id, req.session.user.id, token);
  req.session.flash = 'Share link created.';
  return res.redirect('/dashboard');
});

app.post('/files/:id/delete', csrfProtection, requireAuth, (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id)) return res.status(404).send('Not found');
  const file = db.prepare('SELECT * FROM files WHERE id = ? AND user_id = ?').get(id, req.session.user.id);
  if (!file) return res.status(404).send('Not found');
  try {
    db.prepare('DELETE FROM files WHERE id = ? AND user_id = ?').run(id, req.session.user.id);
    fs.rmSync(safeStoredPath(file.stored_name), { force: true });
    req.session.flash = 'File deleted.';
    return res.redirect('/dashboard');
  } catch (err) {
    return next(err);
  }
});

app.post('/shares/:id/revoke', csrfProtection, requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id)) return res.status(404).send('Not found');
  db.prepare('UPDATE shares SET revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND revoked_at IS NULL')
    .run(id, req.session.user.id);
  req.session.flash = 'Share link revoked.';
  return res.redirect('/dashboard');
});

app.get('/s/:token', (req, res, next) => {
  const token = String(req.params.token || '');
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) return res.status(404).send('Not found');
  const share = db.prepare(`
    SELECT files.*
    FROM shares
    JOIN files ON files.id = shares.file_id
    WHERE shares.token = ? AND shares.revoked_at IS NULL
  `).get(token);
  if (!share) return res.status(404).send('Not found');
  try {
    res.download(safeStoredPath(share.stored_name), share.original_name, {
      headers: {
        'Content-Type': share.mime_type,
        'X-Content-Type-Options': 'nosniff'
      }
    });
  } catch (err) {
    next(err);
  }
});

app.use((req, res) => {
  res.status(404).type('text').send('Not found');
});

app.use((err, req, res, next) => {
  console.error(err);
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).type('text').send('Invalid request token');
  }
  if (err instanceof multer.MulterError) {
    return res.status(400).type('text').send('Invalid upload');
  }
  return res.status(500).type('text').send('Internal server error');
});

app.listen(PORT, () => {
  console.log(`File storage app listening on port ${PORT}`);
});
