'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);

const db = require('./db');
const { hashPassword, verifyPassword } = require('./auth');

const app = express();
const PORT = process.env.PORT || 5032;

// View engine + middleware.
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    store: new SQLiteStore({ db: 'sessions.db', dir: path.join(__dirname, 'data') }),
    secret: process.env.SESSION_SECRET || 'dev-only-insecure-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }, // 1 week
  })
);

// Make the current user available to all views.
app.use((req, res, next) => {
  res.locals.currentUser = req.session.username || null;
  next();
});

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

// ---------- Prepared statements ----------
const stmts = {
  findUserByName: db.prepare('SELECT * FROM users WHERE username = ?'),
  createUser: db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)'),
  listExpenses: db.prepare(
    `SELECT * FROM expenses
     WHERE user_id = ? AND substr(spent_on, 1, 7) = ?
     ORDER BY spent_on DESC, id DESC`
  ),
  monthlyTotal: db.prepare(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM expenses
     WHERE user_id = ? AND substr(spent_on, 1, 7) = ?`
  ),
  getExpense: db.prepare('SELECT * FROM expenses WHERE id = ? AND user_id = ?'),
  insertExpense: db.prepare(
    'INSERT INTO expenses (user_id, amount, category, spent_on, note) VALUES (?, ?, ?, ?, ?)'
  ),
  updateExpense: db.prepare(
    `UPDATE expenses SET amount = ?, category = ?, spent_on = ?, note = ?
     WHERE id = ? AND user_id = ?`
  ),
  deleteExpense: db.prepare('DELETE FROM expenses WHERE id = ? AND user_id = ?'),
};

// ---------- Helpers ----------
function currentMonth() {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

function validateExpense(body) {
  const errors = [];
  const amount = Number.parseFloat(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) errors.push('Amount must be a positive number.');

  const category = (body.category || '').trim();
  if (!category) errors.push('Category is required.');

  const spent_on = (body.spent_on || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(spent_on)) errors.push('Date must be a valid YYYY-MM-DD date.');

  const note = (body.note || '').trim();

  return { errors, value: { amount, category, spent_on, note } };
}

// ---------- Auth routes ----------
app.get('/', (req, res) => {
  res.redirect(req.session.userId ? '/expenses' : '/login');
});

app.get('/register', (req, res) => {
  res.render('register', { error: null });
});

app.post('/register', (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';

  if (username.length < 3 || password.length < 6) {
    return res.render('register', {
      error: 'Username needs 3+ characters and password needs 6+ characters.',
    });
  }
  if (stmts.findUserByName.get(username)) {
    return res.render('register', { error: 'That username is already taken.' });
  }

  const info = stmts.createUser.run(username, hashPassword(password));
  req.session.userId = info.lastInsertRowid;
  req.session.username = username;
  res.redirect('/expenses');
});

app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';
  const user = stmts.findUserByName.get(username);

  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.render('login', { error: 'Invalid username or password.' });
  }

  req.session.userId = user.id;
  req.session.username = user.username;
  res.redirect('/expenses');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// ---------- Expense routes ----------
app.get('/expenses', requireAuth, (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : currentMonth();
  const expenses = stmts.listExpenses.all(req.session.userId, month);
  const { total } = stmts.monthlyTotal.get(req.session.userId, month);

  res.render('expenses', {
    expenses,
    total,
    month,
    error: null,
    form: { spent_on: new Date().toISOString().slice(0, 10) },
  });
});

app.post('/expenses', requireAuth, (req, res) => {
  const { errors, value } = validateExpense(req.body);
  const month = value.spent_on ? value.spent_on.slice(0, 7) : currentMonth();

  if (errors.length) {
    const listMonth = currentMonth();
    return res.status(400).render('expenses', {
      expenses: stmts.listExpenses.all(req.session.userId, listMonth),
      total: stmts.monthlyTotal.get(req.session.userId, listMonth).total,
      month: listMonth,
      error: errors.join(' '),
      form: req.body,
    });
  }

  stmts.insertExpense.run(
    req.session.userId,
    value.amount,
    value.category,
    value.spent_on,
    value.note
  );
  res.redirect('/expenses?month=' + month);
});

app.get('/expenses/:id/edit', requireAuth, (req, res) => {
  const expense = stmts.getExpense.get(req.params.id, req.session.userId);
  if (!expense) return res.redirect('/expenses');
  res.render('edit', { expense, error: null });
});

app.post('/expenses/:id', requireAuth, (req, res) => {
  const expense = stmts.getExpense.get(req.params.id, req.session.userId);
  if (!expense) return res.redirect('/expenses');

  const { errors, value } = validateExpense(req.body);
  if (errors.length) {
    return res.status(400).render('edit', {
      expense: { ...expense, ...req.body },
      error: errors.join(' '),
    });
  }

  stmts.updateExpense.run(
    value.amount,
    value.category,
    value.spent_on,
    value.note,
    req.params.id,
    req.session.userId
  );
  res.redirect('/expenses?month=' + value.spent_on.slice(0, 7));
});

app.post('/expenses/:id/delete', requireAuth, (req, res) => {
  stmts.deleteExpense.run(req.params.id, req.session.userId);
  res.redirect('/expenses');
});

app.listen(PORT, () => {
  console.log(`Expense tracker running at http://localhost:${PORT}`);
});
