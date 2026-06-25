const path = require('path');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const db = require('./src/db');

const app = express();
const PORT = process.env.PORT || 5032;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-only-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 7
    }
  })
);

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
});

function requireAuth(req, res, next) {
  if (!req.session.user) {
    req.session.flash = { type: 'error', message: 'Please log in first.' };
    return res.redirect('/login');
  }
  next();
}

function monthValue(value) {
  if (/^\d{4}-\d{2}$/.test(value || '')) return value;
  return new Date().toISOString().slice(0, 7);
}

function parseExpense(body) {
  const amount = Number.parseFloat(body.amount);
  return {
    amount,
    category: (body.category || '').trim(),
    expenseDate: body.expenseDate,
    note: (body.note || '').trim()
  };
}

function validateExpense(expense) {
  const errors = [];
  if (!Number.isFinite(expense.amount) || expense.amount <= 0) {
    errors.push('Amount must be greater than zero.');
  }
  if (!expense.category) {
    errors.push('Category is required.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expense.expenseDate || '')) {
    errors.push('Date is required.');
  }
  return errors;
}

app.get('/', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  return res.redirect('/expenses');
});

app.get('/register', (req, res) => {
  res.render('auth/register', { form: { username: '' }, errors: [] });
});

app.post('/register', async (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';
  const errors = [];

  if (username.length < 3) errors.push('Username must be at least 3 characters.');
  if (password.length < 6) errors.push('Password must be at least 6 characters.');
  if (db.findUserByUsername(username)) errors.push('That username is already taken.');

  if (errors.length) {
    return res.status(422).render('auth/register', { form: { username }, errors });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = db.createUser(username, passwordHash);
  req.session.user = { id: user.id, username: user.username };
  return res.redirect('/expenses');
});

app.get('/login', (req, res) => {
  res.render('auth/login', { form: { username: '' }, errors: [] });
});

app.post('/login', async (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';
  const user = db.findUserByUsername(username);

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).render('auth/login', {
      form: { username },
      errors: ['Invalid username or password.']
    });
  }

  req.session.user = { id: user.id, username: user.username };
  return res.redirect('/expenses');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

app.get('/expenses', requireAuth, (req, res) => {
  const selectedMonth = monthValue(req.query.month);
  const expenses = db.listExpenses(req.session.user.id, selectedMonth);
  const monthlyTotal = db.monthlyTotal(req.session.user.id, selectedMonth);

  res.render('expenses/index', {
    expenses,
    monthlyTotal,
    selectedMonth,
    form: {
      amount: '',
      category: '',
      expenseDate: new Date().toISOString().slice(0, 10),
      note: ''
    },
    errors: []
  });
});

app.post('/expenses', requireAuth, (req, res) => {
  const expense = parseExpense(req.body);
  const errors = validateExpense(expense);

  if (errors.length) {
    const selectedMonth = monthValue(req.body.month);
    return res.status(422).render('expenses/index', {
      expenses: db.listExpenses(req.session.user.id, selectedMonth),
      monthlyTotal: db.monthlyTotal(req.session.user.id, selectedMonth),
      selectedMonth,
      form: req.body,
      errors
    });
  }

  db.createExpense(req.session.user.id, expense);
  res.redirect(`/expenses?month=${expense.expenseDate.slice(0, 7)}`);
});

app.get('/expenses/:id/edit', requireAuth, (req, res) => {
  const expense = db.getExpense(req.params.id, req.session.user.id);
  if (!expense) {
    req.session.flash = { type: 'error', message: 'Expense not found.' };
    return res.redirect('/expenses');
  }

  res.render('expenses/edit', { expense, errors: [] });
});

app.post('/expenses/:id/edit', requireAuth, (req, res) => {
  const expense = parseExpense(req.body);
  const errors = validateExpense(expense);
  const existing = db.getExpense(req.params.id, req.session.user.id);

  if (!existing) {
    req.session.flash = { type: 'error', message: 'Expense not found.' };
    return res.redirect('/expenses');
  }

  if (errors.length) {
    return res.status(422).render('expenses/edit', {
      expense: { id: existing.id, ...req.body },
      errors
    });
  }

  db.updateExpense(existing.id, req.session.user.id, expense);
  res.redirect(`/expenses?month=${expense.expenseDate.slice(0, 7)}`);
});

app.post('/expenses/:id/delete', requireAuth, (req, res) => {
  const expense = db.getExpense(req.params.id, req.session.user.id);
  db.deleteExpense(req.params.id, req.session.user.id);
  const month = expense ? expense.expense_date.slice(0, 7) : monthValue(req.body.month);
  res.redirect(`/expenses?month=${month}`);
});

app.listen(PORT, () => {
  console.log(`Expense tracker running on http://localhost:${PORT}`);
});
