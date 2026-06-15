'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);

const db = require('./db');

const app = express();

const PORT = process.env.PORT || 5048;
const REVIEWER_USER = process.env.REVIEWER_USER || 'reviewer';
const REVIEWER_PASS = process.env.REVIEWER_PASS || 'reviewer123';
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me-in-production';

const CATEGORIES = ['Bug', 'Feature Request', 'General', 'Complaint', 'Praise'];

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    store: new SQLiteStore({ db: 'sessions.db', dir: path.join(__dirname, 'data') }),
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 8 }, // 8 hours
  })
);

// Make the logged-in flag available to every view.
app.use((req, res, next) => {
  res.locals.isReviewer = Boolean(req.session.isReviewer);
  next();
});

function requireReviewer(req, res, next) {
  if (req.session.isReviewer) return next();
  return res.redirect('/login');
}

// ---------------------------------------------------------------------------
// Prepared statements
// ---------------------------------------------------------------------------
const insertFeedback = db.prepare(
  'INSERT INTO feedback (category, rating, comment) VALUES (?, ?, ?)'
);

// Whitelist of sortable columns -> actual SQL fragments (prevents injection).
const SORT_COLUMNS = {
  created_at: 'created_at',
  category: 'category',
  rating: 'rating',
};

// ---------------------------------------------------------------------------
// Public routes — submit feedback
// ---------------------------------------------------------------------------
app.get('/', (req, res) => {
  res.render('submit', { categories: CATEGORIES, error: null, submitted: false });
});

app.post('/feedback', (req, res) => {
  const { category, comment } = req.body;
  const rating = Number.parseInt(req.body.rating, 10);

  const errors = [];
  if (!CATEGORIES.includes(category)) errors.push('Please choose a valid category.');
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    errors.push('Rating must be a whole number from 1 to 5.');
  }
  if (!comment || !comment.trim()) errors.push('Comment cannot be empty.');

  if (errors.length) {
    return res.status(400).render('submit', {
      categories: CATEGORIES,
      error: errors.join(' '),
      submitted: false,
    });
  }

  insertFeedback.run(category, rating, comment.trim());
  res.render('submit', { categories: CATEGORIES, error: null, submitted: true });
});

// ---------------------------------------------------------------------------
// Auth routes
// ---------------------------------------------------------------------------
app.get('/login', (req, res) => {
  if (req.session.isReviewer) return res.redirect('/reviews');
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === REVIEWER_USER && password === REVIEWER_PASS) {
    req.session.isReviewer = true;
    return res.redirect('/reviews');
  }
  res.status(401).render('login', { error: 'Invalid username or password.' });
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// ---------------------------------------------------------------------------
// Reviewer routes — sortable list
// ---------------------------------------------------------------------------
app.get('/reviews', requireReviewer, (req, res) => {
  const sort = SORT_COLUMNS[req.query.sort] ? req.query.sort : 'created_at';
  const dir = req.query.dir === 'asc' ? 'ASC' : 'DESC';

  const rows = db
    .prepare(`SELECT id, category, rating, comment, created_at FROM feedback ORDER BY ${SORT_COLUMNS[sort]} ${dir}`)
    .all();

  res.render('reviews', { rows, sort, dir });
});

// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Feedback portal running at http://localhost:${PORT}`);
});
