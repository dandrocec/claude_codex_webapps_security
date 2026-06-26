const crypto = require('crypto');
const path = require('path');

const bcrypt = require('bcrypt');
const express = require('express');
const session = require('express-session');
const SQLiteStoreFactory = require('connect-sqlite3');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const sqlite3 = require('sqlite3').verbose();
const { body, query, param, validationResult } = require('express-validator');

const app = express();
const SQLiteStore = SQLiteStoreFactory(session);

const PORT = Number.parseInt(process.env.PORT || '5051', 10);
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'watchlist.sqlite');
const SESSION_SECRET = process.env.SESSION_SECRET;
const COOKIE_SECURE = process.env.SESSION_COOKIE_SECURE
  ? process.env.SESSION_COOKIE_SECURE === 'true'
  : process.env.NODE_ENV === 'production';

if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  console.error('SESSION_SECRET must be set to at least 32 characters.');
  process.exit(1);
}

const db = new sqlite3.Database(DB_PATH);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) reject(error);
      else resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) reject(error);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) reject(error);
      else resolve(rows);
    });
  });
}

async function initialiseDatabase() {
  await run('PRAGMA foreign_keys = ON');
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS movies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      year INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('plan_to_watch', 'watching', 'completed')),
      rating INTEGER CHECK(rating IS NULL OR (rating BETWEEN 1 AND 10)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
}

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"]
    }
  },
  referrerPolicy: { policy: 'no-referrer' }
}));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', index: false }));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false
}));

app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: __dirname }),
  name: 'watchlist.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: 'strict',
    maxAge: 1000 * 60 * 60 * 2
  }
}));

app.use((req, res, next) => {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;
  res.locals.currentUser = req.session.user || null;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
});

function csrfProtection(req, res, next) {
  const token = req.body && req.body._csrf;
  if (!token || token !== req.session.csrfToken) {
    return res.status(403).render('error', {
      title: 'Forbidden',
      message: 'The request could not be verified.'
    });
  }
  return next();
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    req.session.flash = { type: 'error', message: 'Please log in first.' };
    return res.redirect('/login');
  }
  return next();
}

function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    req.validationErrors = errors.array().map((error) => error.msg);
  }
  next();
}

function normalizedMovieInput(req) {
  return {
    title: String(req.body.title || '').trim(),
    year: Number.parseInt(req.body.year, 10),
    status: String(req.body.status || ''),
    rating: req.body.rating === '' || req.body.rating === undefined
      ? null
      : Number.parseInt(req.body.rating, 10)
  };
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false
});

const usernameRule = body('username')
  .trim()
  .isLength({ min: 3, max: 40 }).withMessage('Username must be 3 to 40 characters.')
  .matches(/^[a-zA-Z0-9_.-]+$/).withMessage('Username may contain letters, numbers, dots, underscores, and hyphens.');

const passwordRule = body('password')
  .isLength({ min: 12, max: 128 }).withMessage('Password must be 12 to 128 characters.');

const movieRules = [
  body('title').trim().isLength({ min: 1, max: 120 }).withMessage('Title is required and must be under 120 characters.'),
  body('year').isInt({ min: 1888, max: 2100 }).withMessage('Year must be between 1888 and 2100.'),
  body('status').isIn(['plan_to_watch', 'watching', 'completed']).withMessage('Choose a valid status.'),
  body('rating').optional({ values: 'falsy' }).isInt({ min: 1, max: 10 }).withMessage('Rating must be blank or between 1 and 10.')
];

app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/movies');
  return res.redirect('/login');
});

app.get('/register', (req, res) => {
  res.render('auth', { title: 'Create Account', action: '/register', mode: 'register', errors: [] });
});

app.post('/register', authLimiter, csrfProtection, usernameRule, passwordRule, handleValidation, async (req, res, next) => {
  try {
    const errors = req.validationErrors || [];
    if (errors.length) {
      return res.status(400).render('auth', { title: 'Create Account', action: '/register', mode: 'register', errors });
    }

    const username = req.body.username.trim();
    const passwordHash = await bcrypt.hash(req.body.password, 12);
    const result = await run('INSERT INTO users (username, password_hash) VALUES (?, ?)', [username, passwordHash]);

    req.session.regenerate((error) => {
      if (error) return next(error);
      req.session.user = { id: result.lastID, username };
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');
      return res.redirect('/movies');
    });
  } catch (error) {
    if (error && error.code === 'SQLITE_CONSTRAINT') {
      return res.status(409).render('auth', {
        title: 'Create Account',
        action: '/register',
        mode: 'register',
        errors: ['That username is already taken.']
      });
    }
    return next(error);
  }
});

app.get('/login', (req, res) => {
  res.render('auth', { title: 'Log In', action: '/login', mode: 'login', errors: [] });
});

app.post('/login', authLimiter, csrfProtection, usernameRule, passwordRule, handleValidation, async (req, res, next) => {
  try {
    const genericError = ['Invalid username or password.'];
    if (req.validationErrors) {
      return res.status(400).render('auth', { title: 'Log In', action: '/login', mode: 'login', errors: genericError });
    }

    const user = await get('SELECT id, username, password_hash FROM users WHERE username = ?', [req.body.username.trim()]);
    const valid = user ? await bcrypt.compare(req.body.password, user.password_hash) : false;
    if (!valid) {
      return res.status(401).render('auth', { title: 'Log In', action: '/login', mode: 'login', errors: genericError });
    }

    req.session.regenerate((error) => {
      if (error) return next(error);
      req.session.user = { id: user.id, username: user.username };
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');
      return res.redirect('/movies');
    });
  } catch (error) {
    return next(error);
  }
});

app.post('/logout', csrfProtection, requireAuth, (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie('watchlist.sid');
    return res.redirect('/login');
  });
});

app.get('/movies',
  requireAuth,
  query('status').optional({ values: 'falsy' }).isIn(['plan_to_watch', 'watching', 'completed']),
  handleValidation,
  async (req, res, next) => {
    try {
      const status = req.validationErrors ? '' : (req.query.status || '');
      const params = [req.session.user.id];
      let sql = 'SELECT id, title, year, status, rating FROM movies WHERE user_id = ?';
      if (status) {
        sql += ' AND status = ?';
        params.push(status);
      }
      sql += ' ORDER BY updated_at DESC, id DESC';
      const movies = await all(sql, params);
      res.render('movies', { title: 'Movie Watchlist', movies, status, errors: [] });
    } catch (error) {
      next(error);
    }
  });

app.post('/movies', requireAuth, csrfProtection, movieRules, handleValidation, async (req, res, next) => {
  try {
    if (req.validationErrors) {
      const movies = await all('SELECT id, title, year, status, rating FROM movies WHERE user_id = ? ORDER BY updated_at DESC, id DESC', [req.session.user.id]);
      return res.status(400).render('movies', {
        title: 'Movie Watchlist',
        movies,
        status: '',
        errors: req.validationErrors,
        form: normalizedMovieInput(req)
      });
    }

    const movie = normalizedMovieInput(req);
    await run(
      'INSERT INTO movies (user_id, title, year, status, rating) VALUES (?, ?, ?, ?, ?)',
      [req.session.user.id, movie.title, movie.year, movie.status, movie.rating]
    );
    req.session.flash = { type: 'success', message: 'Movie added.' };
    res.redirect('/movies');
  } catch (error) {
    next(error);
  }
});

app.post('/movies/:id/delete',
  requireAuth,
  csrfProtection,
  param('id').isInt({ min: 1 }),
  handleValidation,
  async (req, res, next) => {
    try {
      if (req.validationErrors) {
        return res.status(404).render('error', { title: 'Not Found', message: 'Movie not found.' });
      }
      const result = await run('DELETE FROM movies WHERE id = ? AND user_id = ?', [req.params.id, req.session.user.id]);
      if (result.changes === 0) {
        return res.status(404).render('error', { title: 'Not Found', message: 'Movie not found.' });
      }
      req.session.flash = { type: 'success', message: 'Movie deleted.' };
      return res.redirect('/movies');
    } catch (error) {
      return next(error);
    }
  });

app.use((req, res) => {
  res.status(404).render('error', { title: 'Not Found', message: 'Page not found.' });
});

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  return res.status(500).render('error', {
    title: 'Server Error',
    message: 'Something went wrong. Please try again later.'
  });
});

initialiseDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Movie watchlist listening on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Failed to initialise database:', error);
    process.exit(1);
  });
