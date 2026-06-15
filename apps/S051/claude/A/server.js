const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcryptjs');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 5051;

// Valid statuses for a movie. Keep in sync with the views.
const STATUSES = ['to_watch', 'watching', 'watched'];
const STATUS_LABELS = {
  to_watch: 'To Watch',
  watching: 'Watching',
  watched: 'Watched',
};

// --- App config -----------------------------------------------------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    store: new SQLiteStore({ db: 'sessions.db', dir: __dirname }),
    secret: process.env.SESSION_SECRET || 'change-me-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }, // 1 week
  })
);

// Make the current user and label helpers available to every template.
app.use((req, res, next) => {
  res.locals.currentUser = req.session.username || null;
  res.locals.statusLabels = STATUS_LABELS;
  next();
});

// --- Helpers --------------------------------------------------------------
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

// --- Auth routes ----------------------------------------------------------
app.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('register', { error: null });
});

app.post('/register', (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';

  if (username.length < 3 || password.length < 6) {
    return res.status(400).render('register', {
      error: 'Username must be 3+ characters and password 6+ characters.',
    });
  }

  try {
    const hash = bcrypt.hashSync(password, 10);
    const info = db
      .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
      .run(username, hash);
    req.session.userId = info.lastInsertRowid;
    req.session.username = username;
    res.redirect('/');
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res
        .status(409)
        .render('register', { error: 'That username is already taken.' });
    }
    throw err;
  }
});

app.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';

  const user = db
    .prepare('SELECT * FROM users WHERE username = ?')
    .get(username);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res
      .status(401)
      .render('login', { error: 'Invalid username or password.' });
  }

  req.session.userId = user.id;
  req.session.username = user.username;
  res.redirect('/');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// --- Watchlist routes -----------------------------------------------------
app.get('/', requireAuth, (req, res) => {
  const filter = req.query.status;
  let movies;

  if (STATUSES.includes(filter)) {
    movies = db
      .prepare(
        'SELECT * FROM movies WHERE user_id = ? AND status = ? ORDER BY created_at DESC'
      )
      .all(req.session.userId, filter);
  } else {
    movies = db
      .prepare(
        'SELECT * FROM movies WHERE user_id = ? ORDER BY created_at DESC'
      )
      .all(req.session.userId);
  }

  res.render('index', {
    movies,
    statuses: STATUSES,
    activeFilter: STATUSES.includes(filter) ? filter : 'all',
  });
});

app.post('/movies', requireAuth, (req, res) => {
  const title = (req.body.title || '').trim();
  const year = parseInt(req.body.year, 10);
  const status = STATUSES.includes(req.body.status)
    ? req.body.status
    : 'to_watch';
  let rating = parseInt(req.body.rating, 10);
  if (Number.isNaN(rating) || rating < 1 || rating > 10) rating = null;

  if (title) {
    db.prepare(
      'INSERT INTO movies (user_id, title, year, status, rating) VALUES (?, ?, ?, ?, ?)'
    ).run(
      req.session.userId,
      title,
      Number.isNaN(year) ? null : year,
      status,
      rating
    );
  }

  res.redirect('back');
});

app.post('/movies/:id/delete', requireAuth, (req, res) => {
  db.prepare('DELETE FROM movies WHERE id = ? AND user_id = ?').run(
    req.params.id,
    req.session.userId
  );
  res.redirect('back');
});

app.listen(PORT, () => {
  console.log(`Movie watchlist running at http://localhost:${PORT}`);
});
