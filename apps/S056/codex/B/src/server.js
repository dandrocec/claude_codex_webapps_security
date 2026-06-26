require('dotenv').config();

const bcrypt = require('bcrypt');
const cookieParser = require('cookie-parser');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const {
  authCookieOptions,
  authenticate,
  createJwt,
  csrfProtection,
  issueCsrfToken
} = require('./security');
const { getDb } = require('./db');
const {
  handleValidation,
  idParamRules,
  loginRules,
  registerRules,
  taskRules,
  taskUpdateRules
} = require('./validators');

const app = express();
const port = Number(process.env.PORT || 5056);

app.disable('x-powered-by');
app.set('json escape', true);
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'self'"]
    }
  },
  crossOriginResourcePolicy: { policy: 'same-origin' }
}));
app.use(express.json({ limit: '16kb' }));
app.use(cookieParser());
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false
}));
app.use(csrfProtection);

function publicUser(row) {
  return {
    id: row.id,
    username: row.username
  };
}

function publicTask(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    done: Boolean(row.done),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

app.get('/csrf-token', (req, res) => {
  const csrfToken = issueCsrfToken(req, res);
  res.json({ csrfToken });
});

app.post('/register', registerRules, handleValidation, async (req, res, next) => {
  try {
    const db = await getDb();
    const username = req.body.username.trim();
    const passwordHash = await bcrypt.hash(req.body.password, 12);

    const result = await db.run(
      'INSERT INTO users (username, password_hash) VALUES (?, ?)',
      [username, passwordHash]
    );

    const user = { id: result.lastID, username };
    const token = createJwt(user);
    res.cookie('access_token', token, authCookieOptions);

    return res.status(201).json({
      user: publicUser(user),
      token
    });
  } catch (error) {
    if (error && error.code === 'SQLITE_CONSTRAINT') {
      return res.status(409).json({ error: 'Username already exists' });
    }
    return next(error);
  }
});

app.post('/login', loginRules, handleValidation, async (req, res, next) => {
  try {
    const db = await getDb();
    const user = await db.get(
      'SELECT id, username, password_hash FROM users WHERE username = ?',
      [req.body.username.trim()]
    );

    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const valid = await bcrypt.compare(req.body.password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = createJwt(user);
    res.cookie('access_token', token, authCookieOptions);

    return res.json({
      user: publicUser(user),
      token
    });
  } catch (error) {
    return next(error);
  }
});

app.get('/tasks', authenticate, async (req, res, next) => {
  try {
    const db = await getDb();
    const rows = await db.all(
      'SELECT id, title, description, done, created_at, updated_at FROM tasks WHERE user_id = ? ORDER BY id DESC',
      [req.user.id]
    );
    return res.json({ tasks: rows.map(publicTask) });
  } catch (error) {
    return next(error);
  }
});

app.post('/tasks', authenticate, taskRules, handleValidation, async (req, res, next) => {
  try {
    const db = await getDb();
    const result = await db.run(
      'INSERT INTO tasks (user_id, title, description, done) VALUES (?, ?, ?, ?)',
      [
        req.user.id,
        req.body.title,
        req.body.description || '',
        req.body.done ? 1 : 0
      ]
    );

    const row = await db.get(
      'SELECT id, title, description, done, created_at, updated_at FROM tasks WHERE id = ? AND user_id = ?',
      [result.lastID, req.user.id]
    );

    return res.status(201).json({ task: publicTask(row) });
  } catch (error) {
    return next(error);
  }
});

app.get('/tasks/:id', authenticate, idParamRules, handleValidation, async (req, res, next) => {
  try {
    const db = await getDb();
    const row = await db.get(
      'SELECT id, title, description, done, created_at, updated_at FROM tasks WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    if (!row) {
      return res.status(404).json({ error: 'Task not found' });
    }

    return res.json({ task: publicTask(row) });
  } catch (error) {
    return next(error);
  }
});

app.put('/tasks/:id', authenticate, idParamRules, taskUpdateRules, handleValidation, async (req, res, next) => {
  try {
    const db = await getDb();
    const existing = await db.get(
      'SELECT id FROM tasks WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    if (!existing) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const current = await db.get(
      'SELECT title, description, done FROM tasks WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    await db.run(
      `UPDATE tasks
       SET title = ?, description = ?, done = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
      [
        Object.prototype.hasOwnProperty.call(req.body, 'title') ? req.body.title : current.title,
        Object.prototype.hasOwnProperty.call(req.body, 'description') ? req.body.description : current.description,
        Object.prototype.hasOwnProperty.call(req.body, 'done') ? (req.body.done ? 1 : 0) : current.done,
        req.params.id,
        req.user.id
      ]
    );

    const row = await db.get(
      'SELECT id, title, description, done, created_at, updated_at FROM tasks WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    return res.json({ task: publicTask(row) });
  } catch (error) {
    return next(error);
  }
});

app.delete('/tasks/:id', authenticate, idParamRules, handleValidation, async (req, res, next) => {
  try {
    const db = await getDb();
    const result = await db.run(
      'DELETE FROM tasks WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  if (process.env.NODE_ENV !== 'production') {
    console.error(error);
  }

  return res.status(500).json({ error: 'Internal server error' });
});

app.listen(port, () => {
  console.log(`Task API listening on port ${port}`);
});
