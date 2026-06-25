require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const bcrypt = require('bcrypt');
const csurf = require('csurf');
const express = require('express');
const session = require('express-session');
const fsSync = require('fs');
const SQLiteStoreFactory = require('connect-sqlite3');
const { body, validationResult } = require('express-validator');
const helmet = require('helmet');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const db = require('./db');

const app = express();
const SQLiteStore = SQLiteStoreFactory(session);
const PORT = Number(process.env.PORT || 5045);
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 5 * 1024 * 1024);
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET must be set to at least 32 characters.');
}

const uploadDir = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, '..', 'uploads');

const sessionDir = process.env.SESSION_DIR
  ? path.resolve(process.env.SESSION_DIR)
  : path.join(__dirname, '..', 'data', 'sessions');

fsSync.mkdirSync(uploadDir, { recursive: true, mode: 0o700 });
fsSync.mkdirSync(sessionDir, { recursive: true, mode: 0o700 });

const allowedTypes = new Map([
  ['image/png', { extensions: ['png'], signatures: ['89504e470d0a1a0a'] }],
  ['image/jpeg', { extensions: ['jpg'], signatures: ['ffd8ff'] }],
  ['application/pdf', { extensions: ['pdf'], signatures: ['25504446'] }],
  ['text/plain', { extensions: ['txt'], signatures: [] }]
]);

const queries = {
  createUser: db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)'),
  findUserByUsername: db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?'),
  findUserById: db.prepare('SELECT id, username FROM users WHERE id = ?'),
  insertUpload: db.prepare(`
    INSERT INTO uploads (user_id, original_name, stored_name, mime_type, byte_size)
    VALUES (?, ?, ?, ?, ?)
  `),
  listUploads: db.prepare(`
    SELECT id, original_name, mime_type, byte_size, created_at
    FROM uploads
    WHERE user_id = ?
    ORDER BY created_at DESC, id DESC
  `),
  findUploadForUser: db.prepare(`
    SELECT id, original_name, stored_name, mime_type, byte_size
    FROM uploads
    WHERE id = ? AND user_id = ?
  `),
  deleteUploadForUser: db.prepare('DELETE FROM uploads WHERE id = ? AND user_id = ?')
};

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false
}));

app.use(express.urlencoded({ extended: false, limit: '32kb' }));
app.use('/static', express.static(path.join(__dirname, 'public'), {
  etag: true,
  fallthrough: false,
  index: false,
  maxAge: '1h'
}));

app.use(session({
  store: new SQLiteStore({
    db: 'sessions.sqlite',
    dir: sessionDir
  }),
  name: 'sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE !== 'false',
    sameSite: 'strict',
    maxAge: 1000 * 60 * 60
  }
}));

const csrfProtection = csurf();
app.use((req, res, next) => {
  if (req.method === 'POST' && req.path === '/uploads') return next();
  return csrfProtection(req, res, next);
});

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.csrfToken = typeof req.csrfToken === 'function' ? req.csrfToken() : '';
  res.locals.messages = req.session.messages || [];
  delete req.session.messages;
  next();
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1
  }
});

function flash(req, type, text) {
  req.session.messages = [{ type, text }];
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  return next();
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function safeDisplayName(name) {
  const base = path.basename(String(name || 'upload'));
  return base.replace(/[^\w .()+,[\]@-]/g, '_').slice(0, 120) || 'upload';
}

function isPlainText(buffer) {
  if (buffer.length === 0) return true;
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  for (const byte of sample) {
    const printable = byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126) || byte >= 128;
    if (!printable) return false;
  }
  return sample.toString('utf8').includes('\uFFFD') === false;
}

async function inspectAllowedFile(buffer) {
  const { fileTypeFromBuffer } = await import('file-type');
  const detected = await fileTypeFromBuffer(buffer);
  if (detected && allowedTypes.has(detected.mime)) {
    return { mime: detected.mime, extension: allowedTypes.get(detected.mime).extensions[0] };
  }
  if (!detected && isPlainText(buffer)) {
    return { mime: 'text/plain', extension: 'txt' };
  }
  return null;
}

function resolveUploadPath(storedName) {
  const resolved = path.resolve(uploadDir, path.basename(storedName));
  const root = path.resolve(uploadDir) + path.sep;
  if (!resolved.startsWith(root)) {
    throw new Error('Invalid upload path.');
  }
  return resolved;
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/uploads');
  return res.redirect('/login');
});

app.get('/register', (req, res) => {
  res.render('register', { errors: [], form: {} });
});

app.post('/register',
  body('username')
    .customSanitizer(normalizeUsername)
    .isLength({ min: 3, max: 32 }).withMessage('Username must be 3 to 32 characters.')
    .matches(/^[a-z0-9_-]+$/).withMessage('Use letters, numbers, underscores, or hyphens.'),
  body('password')
    .isLength({ min: 12, max: 128 }).withMessage('Password must be at least 12 characters.'),
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).render('register', { errors: errors.array(), form: { username: req.body.username } });
    }

    const username = normalizeUsername(req.body.username);
    const passwordHash = await bcrypt.hash(req.body.password, 12);
    try {
      queries.createUser.run(username, passwordHash);
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return res.status(409).render('register', {
          errors: [{ msg: 'That username is already taken.' }],
          form: { username }
        });
      }
      throw error;
    }

    flash(req, 'success', 'Account created. Please sign in.');
    return res.redirect('/login');
  })
);

app.get('/login', (req, res) => {
  res.render('login', { errors: [], form: {} });
});

app.post('/login',
  rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false }),
  body('username').customSanitizer(normalizeUsername).isLength({ min: 3, max: 32 }),
  body('password').isLength({ min: 1, max: 128 }),
  asyncHandler(async (req, res, next) => {
    const invalid = 'Invalid username or password.';
    if (!validationResult(req).isEmpty()) {
      return res.status(400).render('login', { errors: [{ msg: invalid }], form: { username: req.body.username } });
    }

    const user = queries.findUserByUsername.get(normalizeUsername(req.body.username));
    const ok = user ? await bcrypt.compare(req.body.password, user.password_hash) : false;
    if (!ok) {
      return res.status(401).render('login', { errors: [{ msg: invalid }], form: { username: req.body.username } });
    }

    req.session.regenerate((error) => {
      if (error) return next(error);
      req.session.user = { id: user.id, username: user.username };
      return res.redirect('/uploads');
    });
  })
);

app.post('/logout', requireAuth, (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie('sid');
    return res.redirect('/login');
  });
});

app.get('/uploads', requireAuth, (req, res) => {
  const uploads = queries.listUploads.all(req.session.user.id);
  res.render('uploads', {
    uploads,
    maxUploadMb: Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024),
    errors: []
  });
});

app.post('/uploads', requireAuth, upload.single('file'), csrfProtection, asyncHandler(async (req, res) => {
  res.locals.csrfToken = req.csrfToken();
  if (!req.file) {
    const uploads = queries.listUploads.all(req.session.user.id);
    return res.status(400).render('uploads', {
      uploads,
      maxUploadMb: Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024),
      errors: [{ msg: 'Choose a file to upload.' }]
    });
  }

  const inspected = await inspectAllowedFile(req.file.buffer);
  if (!inspected) {
    const uploads = queries.listUploads.all(req.session.user.id);
    return res.status(400).render('uploads', {
      uploads,
      maxUploadMb: Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024),
      errors: [{ msg: 'Only PNG, JPEG, PDF, and plain text files are allowed.' }]
    });
  }

  await fs.mkdir(uploadDir, { recursive: true, mode: 0o700 });
  const storedName = `${crypto.randomUUID()}.${inspected.extension}`;
  const destination = resolveUploadPath(storedName);
  await fs.writeFile(destination, req.file.buffer, { flag: 'wx', mode: 0o600 });

  queries.insertUpload.run(
    req.session.user.id,
    safeDisplayName(req.file.originalname),
    storedName,
    inspected.mime,
    req.file.size
  );

  flash(req, 'success', 'File uploaded.');
  res.redirect('/uploads');
}));

app.get('/uploads/:id/download',
  requireAuth,
  body().custom(() => true),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(404).render('not-found');

    const uploadRow = queries.findUploadForUser.get(id, req.session.user.id);
    if (!uploadRow) return res.status(404).render('not-found');

    const filePath = resolveUploadPath(uploadRow.stored_name);
    res.type(uploadRow.mime_type);
    return res.download(filePath, uploadRow.original_name);
  })
);

app.post('/uploads/:id/delete', requireAuth, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(404).render('not-found');

  const uploadRow = queries.findUploadForUser.get(id, req.session.user.id);
  if (!uploadRow) return res.status(404).render('not-found');

  queries.deleteUploadForUser.run(id, req.session.user.id);
  await fs.rm(resolveUploadPath(uploadRow.stored_name), { force: true });
  flash(req, 'success', 'File deleted.');
  res.redirect('/uploads');
}));

app.use((req, res) => {
  res.status(404).render('not-found');
});

app.use((error, req, res, next) => {
  if (error.code === 'EBADCSRFTOKEN') {
    return res.status(403).render('error', { message: 'The form expired. Please go back and try again.' });
  }
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).render('error', { message: 'The uploaded file is too large.' });
  }
  console.error(error);
  return res.status(500).render('error', { message: 'Something went wrong.' });
});

app.listen(PORT, () => {
  console.log(`File sharing app listening on port ${PORT}`);
});
