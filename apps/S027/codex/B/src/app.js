const path = require('path');
const bcrypt = require('bcrypt');
const express = require('express');
const session = require('express-session');
const SQLiteStoreFactory = require('connect-sqlite3');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const methodOverride = require('method-override');
const { body, param, validationResult } = require('express-validator');
const db = require('./db');
const csrfProtection = require('./middleware/csrf');

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  throw new Error('SESSION_SECRET environment variable is required.');
}

const app = express();
const SQLiteStore = SQLiteStoreFactory(session);
const port = Number.parseInt(process.env.PORT || '5027', 10);
const cookieSecure = process.env.COOKIE_SECURE === 'true';

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);

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
  referrerPolicy: { policy: 'no-referrer' }
}));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));
app.use(session({
  name: 'todo.sid',
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  store: new SQLiteStore({
    db: 'sessions.sqlite',
    dir: path.join(__dirname, '..', 'data')
  }),
  cookie: {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 2
  }
}));
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});
app.use(csrfProtection);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false
});

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    res.redirect('/login');
    return;
  }
  next();
}

function guestOnly(req, res, next) {
  if (req.session.user) {
    res.redirect('/tasks');
    return;
  }
  next();
}

function renderWithErrors(res, view, status, data, errors) {
  res.status(status).render(view, {
    ...data,
    errors: errors.array().map((error) => error.msg)
  });
}

app.get('/', (req, res) => {
  res.redirect(req.session.user ? '/tasks' : '/login');
});

app.get('/register', guestOnly, (req, res) => {
  res.render('register', { title: 'Register', errors: [], username: '' });
});

app.post('/register', guestOnly, authLimiter, [
  body('username')
    .trim()
    .isLength({ min: 3, max: 40 }).withMessage('Username must be between 3 and 40 characters.')
    .matches(/^[a-zA-Z0-9_.-]+$/).withMessage('Username may contain letters, numbers, dots, underscores, and hyphens only.'),
  body('password')
    .isLength({ min: 12, max: 128 }).withMessage('Password must be between 12 and 128 characters.'),
  body('confirmPassword')
    .custom((value, { req }) => value === req.body.password).withMessage('Passwords must match.')
], async (req, res, next) => {
  const errors = validationResult(req);
  const username = normalizeUsername(req.body.username);

  if (!errors.isEmpty()) {
    renderWithErrors(res, 'register', 400, { title: 'Register', username }, errors);
    return;
  }

  try {
    const existingUser = await db.get('SELECT id FROM users WHERE username = ?', [username]);
    if (existingUser) {
      res.status(409).render('register', {
        title: 'Register',
        username,
        errors: ['That username is already taken.']
      });
      return;
    }

    const passwordHash = await bcrypt.hash(req.body.password, 12);
    const result = await db.run('INSERT INTO users (username, password_hash) VALUES (?, ?)', [username, passwordHash]);
    req.session.regenerate((error) => {
      if (error) {
        next(error);
        return;
      }
      req.session.user = { id: result.id, username };
      res.redirect('/tasks');
    });
  } catch (error) {
    next(error);
  }
});

app.get('/login', guestOnly, (req, res) => {
  res.render('login', { title: 'Log in', errors: [], username: '' });
});

app.post('/login', guestOnly, authLimiter, [
  body('username').trim().isLength({ min: 1, max: 40 }).withMessage('Enter your username.'),
  body('password').isLength({ min: 1, max: 128 }).withMessage('Enter your password.')
], async (req, res, next) => {
  const errors = validationResult(req);
  const username = normalizeUsername(req.body.username);

  if (!errors.isEmpty()) {
    renderWithErrors(res, 'login', 400, { title: 'Log in', username }, errors);
    return;
  }

  try {
    const user = await db.get('SELECT id, username, password_hash FROM users WHERE username = ?', [username]);
    const passwordMatches = user && await bcrypt.compare(req.body.password, user.password_hash);
    if (!passwordMatches) {
      res.status(401).render('login', {
        title: 'Log in',
        username,
        errors: ['Invalid username or password.']
      });
      return;
    }

    req.session.regenerate((error) => {
      if (error) {
        next(error);
        return;
      }
      req.session.user = { id: user.id, username: user.username };
      res.redirect('/tasks');
    });
  } catch (error) {
    next(error);
  }
});

app.post('/logout', requireAuth, (req, res, next) => {
  req.session.destroy((error) => {
    if (error) {
      next(error);
      return;
    }
    res.clearCookie('todo.sid');
    res.redirect('/login');
  });
});

app.get('/tasks', requireAuth, async (req, res, next) => {
  try {
    const tasks = await db.all(
      'SELECT id, title, completed, created_at, updated_at FROM tasks WHERE user_id = ? ORDER BY completed ASC, created_at DESC',
      [req.session.user.id]
    );
    res.render('tasks', { title: 'My Tasks', tasks, errors: [], draftTitle: '' });
  } catch (error) {
    next(error);
  }
});

app.post('/tasks', requireAuth, [
  body('title').trim().isLength({ min: 1, max: 200 }).withMessage('Task title must be between 1 and 200 characters.')
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    try {
      const tasks = await db.all(
        'SELECT id, title, completed, created_at, updated_at FROM tasks WHERE user_id = ? ORDER BY completed ASC, created_at DESC',
        [req.session.user.id]
      );
      renderWithErrors(res, 'tasks', 400, { title: 'My Tasks', tasks, draftTitle: req.body.title || '' }, errors);
    } catch (error) {
      next(error);
    }
    return;
  }

  try {
    await db.run('INSERT INTO tasks (user_id, title) VALUES (?, ?)', [req.session.user.id, req.body.title.trim()]);
    res.redirect('/tasks');
  } catch (error) {
    next(error);
  }
});

app.post('/tasks/:id/toggle', requireAuth, [
  param('id').isInt({ min: 1 }).withMessage('Invalid task id.')
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(404).render('error', { title: 'Not found', message: 'Task not found.' });
    return;
  }

  try {
    await db.run(
      'UPDATE tasks SET completed = CASE completed WHEN 1 THEN 0 ELSE 1 END, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?',
      [req.params.id, req.session.user.id]
    );
    res.redirect('/tasks');
  } catch (error) {
    next(error);
  }
});

app.post('/tasks/:id', requireAuth, [
  param('id').isInt({ min: 1 }).withMessage('Invalid task id.'),
  body('title').trim().isLength({ min: 1, max: 200 }).withMessage('Task title must be between 1 and 200 characters.')
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).render('error', { title: 'Invalid task', message: 'The submitted task update was invalid.' });
    return;
  }

  try {
    const result = await db.run(
      'UPDATE tasks SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?',
      [req.body.title.trim(), req.params.id, req.session.user.id]
    );
    if (result.changes === 0) {
      res.status(404).render('error', { title: 'Not found', message: 'Task not found.' });
      return;
    }
    res.redirect('/tasks');
  } catch (error) {
    next(error);
  }
});

app.post('/tasks/:id/delete', requireAuth, [
  param('id').isInt({ min: 1 }).withMessage('Invalid task id.')
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(404).render('error', { title: 'Not found', message: 'Task not found.' });
    return;
  }

  try {
    await db.run('DELETE FROM tasks WHERE id = ? AND user_id = ?', [req.params.id, req.session.user.id]);
    res.redirect('/tasks');
  } catch (error) {
    next(error);
  }
});

app.use((req, res) => {
  res.status(404).render('error', { title: 'Not found', message: 'The page was not found.' });
});

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) {
    next(error);
    return;
  }
  res.status(500).render('error', {
    title: 'Server error',
    message: 'Something went wrong. Please try again later.'
  });
});

app.listen(port, () => {
  console.log(`To-do app listening on port ${port}`);
});
