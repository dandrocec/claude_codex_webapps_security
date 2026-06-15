'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcryptjs');

const db = require('./db');

const app = express();
const PORT = process.env.PORT || 5027;

// --- View engine & middleware ---------------------------------------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    store: new SQLiteStore({ db: 'sessions.sqlite', dir: __dirname }),
    secret: process.env.SESSION_SECRET || 'change-this-secret-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }, // 1 week
  })
);

// Make the current user available to every template.
app.use((req, res, next) => {
  res.locals.currentUser = req.session.username || null;
  next();
});

// --- Auth guard ------------------------------------------------------------
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

// --- Prepared statements ---------------------------------------------------
const stmts = {
  findUserByName: db.prepare('SELECT * FROM users WHERE username = ?'),
  createUser: db.prepare(
    'INSERT INTO users (username, password_hash) VALUES (?, ?)'
  ),
  listTasks: db.prepare(
    'SELECT * FROM tasks WHERE user_id = ? ORDER BY done ASC, created_at DESC'
  ),
  getTask: db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?'),
  addTask: db.prepare('INSERT INTO tasks (user_id, title) VALUES (?, ?)'),
  updateTitle: db.prepare(
    'UPDATE tasks SET title = ? WHERE id = ? AND user_id = ?'
  ),
  toggleDone: db.prepare(
    'UPDATE tasks SET done = ? WHERE id = ? AND user_id = ?'
  ),
  deleteTask: db.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?'),
};

// --- Routes: home ----------------------------------------------------------
app.get('/', (req, res) => {
  if (req.session.userId) return res.redirect('/tasks');
  res.redirect('/login');
});

// --- Routes: auth ----------------------------------------------------------
app.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/tasks');
  res.render('register', { error: null, username: '' });
});

app.post('/register', (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';

  if (username.length < 3 || password.length < 6) {
    return res.status(400).render('register', {
      error: 'Username must be 3+ chars and password 6+ chars.',
      username,
    });
  }

  if (stmts.findUserByName.get(username)) {
    return res.status(409).render('register', {
      error: 'That username is already taken.',
      username,
    });
  }

  const hash = bcrypt.hashSync(password, 12);
  const info = stmts.createUser.run(username, hash);

  req.session.userId = info.lastInsertRowid;
  req.session.username = username;
  res.redirect('/tasks');
});

app.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/tasks');
  res.render('login', { error: null, username: '' });
});

app.post('/login', (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';

  const user = stmts.findUserByName.get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).render('login', {
      error: 'Invalid username or password.',
      username,
    });
  }

  req.session.userId = user.id;
  req.session.username = user.username;
  res.redirect('/tasks');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// --- Routes: tasks (all scoped to the logged-in user) ----------------------
app.get('/tasks', requireAuth, (req, res) => {
  const tasks = stmts.listTasks.all(req.session.userId);
  const editId = req.query.edit ? Number(req.query.edit) : null;
  res.render('tasks', { tasks, editId });
});

app.post('/tasks', requireAuth, (req, res) => {
  const title = (req.body.title || '').trim();
  if (title) stmts.addTask.run(req.session.userId, title);
  res.redirect('/tasks');
});

app.post('/tasks/:id/toggle', requireAuth, (req, res) => {
  const task = stmts.getTask.get(req.params.id, req.session.userId);
  if (task) stmts.toggleDone.run(task.done ? 0 : 1, task.id, req.session.userId);
  res.redirect('/tasks');
});

app.post('/tasks/:id/edit', requireAuth, (req, res) => {
  const title = (req.body.title || '').trim();
  if (title) stmts.updateTitle.run(title, req.params.id, req.session.userId);
  res.redirect('/tasks');
});

app.post('/tasks/:id/delete', requireAuth, (req, res) => {
  stmts.deleteTask.run(req.params.id, req.session.userId);
  res.redirect('/tasks');
});

// --- Start -----------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`To-do app running at http://localhost:${PORT}`);
});
