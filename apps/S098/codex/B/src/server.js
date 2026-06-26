require('dotenv').config();

const path = require('path');
const http = require('http');
const express = require('express');
const session = require('express-session');
const SQLiteStoreFactory = require('connect-sqlite3');
const helmet = require('helmet');
const csrf = require('csurf');
const bcrypt = require('bcrypt');
const { body, param, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');
const db = require('./storage');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: false,
  transports: ['websocket', 'polling']
});

const PORT = Number(process.env.PORT || 5098);
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  console.error('SESSION_SECRET must be set to at least 32 characters.');
  process.exit(1);
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "script-src": ["'self'", "https://cdn.socket.io"],
      "connect-src": ["'self'", "ws:", "wss:"],
      "base-uri": ["'none'"],
      "object-src": ["'none'"]
    }
  },
  referrerPolicy: { policy: 'no-referrer' }
}));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(express.json({ limit: '128kb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  fallthrough: true,
  index: false,
  setHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
  }
}));

const SQLiteStore = SQLiteStoreFactory(session);
const sessionMiddleware = session({
  store: new SQLiteStore({
    db: 'sessions.sqlite',
    dir: path.join(__dirname, '..', 'data')
  }),
  name: 'sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 8
  }
});

app.use(sessionMiddleware);
const csrfProtection = csrf();
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.errors = [];
  res.locals.form = {};
  next();
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 25,
  standardHeaders: 'draft-7',
  legacyHeaders: false
});

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

function collectErrors(req) {
  return validationResult(req).array().map((err) => err.msg);
}

function renderWithCsrf(req, res, view, data = {}) {
  res.render(view, { ...data, csrfToken: req.csrfToken() });
}

const usernameRule = body('username')
  .trim()
  .isLength({ min: 3, max: 32 }).withMessage('Username must be 3 to 32 characters.')
  .matches(/^[A-Za-z0-9_.-]+$/).withMessage('Username may contain letters, numbers, dots, underscores, and hyphens.');

const passwordRule = body('password')
  .isLength({ min: 12, max: 128 }).withMessage('Password must be at least 12 characters.');

const titleRule = body('title')
  .trim()
  .isLength({ min: 1, max: 120 }).withMessage('Title is required and must be under 120 characters.');

const docIdParam = param('id').isInt({ min: 1 }).withMessage('Invalid document id.').toInt();

app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/documents');
  res.redirect('/login');
});

app.get('/register', csrfProtection, (req, res) => {
  renderWithCsrf(req, res, 'register');
});

app.post('/register', authLimiter, csrfProtection, usernameRule, passwordRule, async (req, res, next) => {
  try {
    const errors = collectErrors(req);
    if (errors.length) {
      return renderWithCsrf(req, res.status(400), 'register', { errors, form: { username: req.body.username } });
    }

    const passwordHash = await bcrypt.hash(req.body.password, 12);
    const user = await db.createUser(req.body.username, passwordHash);
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = { id: user.id, username: user.username };
      res.redirect('/documents');
    });
  } catch (err) {
    if (err && err.code === 'SQLITE_CONSTRAINT') {
      return renderWithCsrf(req, res.status(409), 'register', {
        errors: ['That username is already taken.'],
        form: { username: req.body.username }
      });
    }
    next(err);
  }
});

app.get('/login', csrfProtection, (req, res) => {
  renderWithCsrf(req, res, 'login');
});

app.post('/login', authLimiter, csrfProtection, usernameRule, passwordRule, async (req, res, next) => {
  try {
    const errors = collectErrors(req);
    if (errors.length) {
      return renderWithCsrf(req, res.status(400), 'login', { errors, form: { username: req.body.username } });
    }

    const user = await db.findUserByUsername(req.body.username);
    const ok = user ? await bcrypt.compare(req.body.password, user.password_hash) : false;
    if (!ok) {
      return renderWithCsrf(req, res.status(401), 'login', {
        errors: ['Invalid username or password.'],
        form: { username: req.body.username }
      });
    }

    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = { id: user.id, username: user.username };
      res.redirect('/documents');
    });
  } catch (err) {
    next(err);
  }
});

app.post('/logout', csrfProtection, requireAuth, (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('sid');
    res.redirect('/login');
  });
});

app.get('/documents', csrfProtection, requireAuth, async (req, res, next) => {
  try {
    const documents = await db.listDocumentsForUser(req.session.user.id);
    renderWithCsrf(req, res, 'documents', { documents });
  } catch (err) {
    next(err);
  }
});

app.post('/documents', csrfProtection, requireAuth, titleRule, async (req, res, next) => {
  try {
    const errors = collectErrors(req);
    if (errors.length) {
      const documents = await db.listDocumentsForUser(req.session.user.id);
      return renderWithCsrf(req, res.status(400), 'documents', { documents, errors, form: { title: req.body.title } });
    }
    const doc = await db.createDocument(req.session.user.id, req.body.title);
    res.redirect(`/documents/${doc.id}`);
  } catch (err) {
    next(err);
  }
});

app.get('/documents/:id', csrfProtection, requireAuth, docIdParam, async (req, res, next) => {
  try {
    const errors = collectErrors(req);
    if (errors.length) return res.status(404).render('not-found');

    const access = await db.getDocumentAccess(req.params.id, req.session.user.id);
    if (!access) return res.status(404).render('not-found');

    const collaborators = await db.listCollaborators(req.params.id);
    renderWithCsrf(req, res, 'editor', { doc: access, collaborators });
  } catch (err) {
    next(err);
  }
});

app.post('/documents/:id/invite', csrfProtection, requireAuth, docIdParam,
  body('username').trim().isLength({ min: 3, max: 32 }).withMessage('Enter a valid username.'),
  body('role').isIn(['view', 'edit']).withMessage('Choose view or edit access.'),
  async (req, res, next) => {
    try {
      const errors = collectErrors(req);
      const ownerAccess = errors.length ? null : await db.getDocumentAccess(req.params.id, req.session.user.id);
      if (errors.length || !ownerAccess || ownerAccess.owner_id !== req.session.user.id) {
        return res.status(ownerAccess ? 400 : 404).redirect(`/documents/${req.params.id}`);
      }

      const invitedUser = await db.findUserByUsername(req.body.username);
      if (invitedUser && invitedUser.id !== req.session.user.id) {
        await db.upsertCollaborator(req.params.id, invitedUser.id, req.body.role);
      }
      res.redirect(`/documents/${req.params.id}`);
    } catch (err) {
      next(err);
    }
  }
);

app.post('/documents/:id/collaborators/:userId/remove', csrfProtection, requireAuth,
  param('id').isInt({ min: 1 }).toInt(),
  param('userId').isInt({ min: 1 }).toInt(),
  async (req, res, next) => {
    try {
      const errors = collectErrors(req);
      const ownerAccess = errors.length ? null : await db.getDocumentAccess(req.params.id, req.session.user.id);
      if (errors.length || !ownerAccess || ownerAccess.owner_id !== req.session.user.id) {
        return res.status(404).render('not-found');
      }
      await db.removeCollaborator(req.params.id, req.params.userId);
      res.redirect(`/documents/${req.params.id}`);
    } catch (err) {
      next(err);
    }
  }
);

io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

io.on('connection', (socket) => {
  const user = socket.request.session && socket.request.session.user;
  if (!user) {
    socket.disconnect(true);
    return;
  }

  socket.on('join-document', async ({ documentId }) => {
    const id = Number(documentId);
    if (!Number.isSafeInteger(id) || id < 1) return;

    const access = await db.getDocumentAccess(id, user.id);
    if (!access) return;

    socket.data.documentId = id;
    socket.data.role = access.role;
    socket.join(`doc:${id}`);
    socket.emit('document-state', {
      content: access.content,
      role: access.role,
      updatedAt: access.updated_at
    });
  });

  socket.on('document-change', async ({ documentId, content }) => {
    const id = Number(documentId);
    if (!Number.isSafeInteger(id) || id < 1 || typeof content !== 'string' || content.length > 200000) return;

    const access = await db.getDocumentAccess(id, user.id);
    if (!access || access.role !== 'edit') return;

    const saved = await db.updateDocumentContent(id, user.id, content);
    io.to(`doc:${id}`).emit('document-state', {
      content: saved.content,
      role: undefined,
      updatedAt: saved.updated_at
    });
  });
});

app.use((req, res) => {
  res.status(404).render('not-found');
});

app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).render('error', { message: 'The form expired. Please try again.' });
  }
  console.error(err);
  res.status(500).render('error', { message: 'Something went wrong.' });
});

db.init().then(() => {
  server.listen(PORT, () => {
    console.log(`Collaborative editor listening on port ${PORT}`);
  });
}).catch((err) => {
  console.error('Failed to initialize database.');
  console.error(err);
  process.exit(1);
});
