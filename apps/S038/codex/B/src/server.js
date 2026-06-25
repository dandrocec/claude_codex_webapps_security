const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStoreFactory = require('connect-sqlite3');
const helmet = require('helmet');
const csrf = require('csurf');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const { body, query, validationResult } = require('express-validator');
const sanitizeHtml = require('sanitize-html');
const db = require('./db');

const app = express();
const SQLiteStore = SQLiteStoreFactory(session);
const PORT = Number(process.env.PORT || 5038);
const SESSION_SECRET = process.env.SESSION_SECRET;
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'false' ? false : true;

if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  console.error('SESSION_SECRET must be set to a random value of at least 32 characters.');
  process.exit(1);
}

app.disable('x-powered-by');
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
      imgSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"]
    }
  }
}));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', index: false }));
app.use(express.urlencoded({ extended: false, limit: '32kb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false }));
app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: path.join(__dirname, '..', 'data') }),
  name: 'jobboard.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 4
  }
}));

const csrfProtection = csrf();
app.use(csrfProtection);

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.csrfToken = req.csrfToken();
  res.locals.errors = [];
  res.locals.values = {};
  next();
});

function cleanText(value) {
  return sanitizeHtml(String(value || '').trim(), { allowedTags: [], allowedAttributes: {} });
}

function renderWithErrors(res, view, status, errors, values = {}) {
  return res.status(status).render(view, { errors, values });
}

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

function validationErrors(req) {
  return validationResult(req).array().map((error) => error.msg);
}

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });

const registerRules = [
  body('email').trim().isEmail().withMessage('Enter a valid email address.').normalizeEmail().isLength({ max: 254 }).withMessage('Email is too long.'),
  body('password').isLength({ min: 12, max: 128 }).withMessage('Password must be 12 to 128 characters.')
];

const loginRules = [
  body('email').trim().isEmail().withMessage('Enter a valid email address.').normalizeEmail(),
  body('password').isLength({ min: 1, max: 128 }).withMessage('Enter your password.')
];

const jobRules = [
  body('title').customSanitizer(cleanText).isLength({ min: 3, max: 120 }).withMessage('Title must be 3 to 120 characters.'),
  body('company').customSanitizer(cleanText).isLength({ min: 2, max: 120 }).withMessage('Company must be 2 to 120 characters.'),
  body('location').customSanitizer(cleanText).isLength({ min: 2, max: 120 }).withMessage('Location must be 2 to 120 characters.'),
  body('description').customSanitizer(cleanText).isLength({ min: 20, max: 4000 }).withMessage('Description must be 20 to 4000 characters.')
];

app.get('/', [
  query('q').optional({ values: 'falsy' }).trim().isLength({ max: 100 }).withMessage('Search must be 100 characters or fewer.')
], (req, res) => {
  const errors = validationErrors(req);
  const q = errors.length ? '' : cleanText(req.query.q || '');
  const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
  const jobs = q
    ? db.prepare(`
        SELECT jobs.*, users.email AS poster_email
        FROM jobs JOIN users ON users.id = jobs.user_id
        WHERE title LIKE ? ESCAPE '\\'
           OR company LIKE ? ESCAPE '\\'
           OR description LIKE ? ESCAPE '\\'
           OR location LIKE ? ESCAPE '\\'
        ORDER BY jobs.created_at DESC
      `).all(like, like, like, like)
    : db.prepare(`
        SELECT jobs.*, users.email AS poster_email
        FROM jobs JOIN users ON users.id = jobs.user_id
        ORDER BY jobs.created_at DESC
      `).all();

  res.render('index', { jobs, q, errors });
});

app.get('/register', (req, res) => res.render('register', { values: {} }));

app.post('/register', authLimiter, registerRules, async (req, res, next) => {
  try {
    const errors = validationErrors(req);
    const email = req.body.email;
    if (errors.length) return renderWithErrors(res, 'register', 400, errors, { email });

    const passwordHash = await bcrypt.hash(req.body.password, 12);
    const result = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(email, passwordHash);
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = { id: result.lastInsertRowid, email };
      res.redirect('/');
    });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return renderWithErrors(res, 'register', 409, ['That email is already registered.'], { email: req.body.email });
    }
    next(err);
  }
});

app.get('/login', (req, res) => res.render('login', { values: {} }));

app.post('/login', authLimiter, loginRules, async (req, res, next) => {
  try {
    const errors = validationErrors(req);
    const email = req.body.email;
    if (errors.length) return renderWithErrors(res, 'login', 400, errors, { email });

    const user = db.prepare('SELECT id, email, password_hash FROM users WHERE email = ?').get(email);
    const valid = user ? await bcrypt.compare(req.body.password, user.password_hash) : false;
    if (!valid) return renderWithErrors(res, 'login', 401, ['Invalid email or password.'], { email });

    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = { id: user.id, email: user.email };
      res.redirect('/');
    });
  } catch (err) {
    next(err);
  }
});

app.post('/logout', requireAuth, (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('jobboard.sid');
    res.redirect('/');
  });
});

app.get('/jobs/new', requireAuth, (req, res) => res.render('job-form', {
  mode: 'new',
  action: '/jobs',
  job: {},
  values: {}
}));

app.post('/jobs', requireAuth, jobRules, (req, res) => {
  const errors = validationErrors(req);
  const values = {
    title: req.body.title,
    company: req.body.company,
    location: req.body.location,
    description: req.body.description
  };
  if (errors.length) {
    return res.status(400).render('job-form', { mode: 'new', action: '/jobs', job: {}, values, errors });
  }

  db.prepare(`
    INSERT INTO jobs (user_id, title, company, location, description)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.session.user.id, values.title, values.company, values.location, values.description);
  res.redirect('/');
});

app.get('/jobs/:id/edit', requireAuth, (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ? AND user_id = ?').get(req.params.id, req.session.user.id);
  if (!job) return res.status(404).render('not-found');
  res.render('job-form', { mode: 'edit', action: `/jobs/${job.id}`, job, values: job });
});

app.post('/jobs/:id', requireAuth, jobRules, (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ? AND user_id = ?').get(req.params.id, req.session.user.id);
  if (!job) return res.status(404).render('not-found');

  const errors = validationErrors(req);
  const values = {
    title: req.body.title,
    company: req.body.company,
    location: req.body.location,
    description: req.body.description
  };
  if (errors.length) {
    return res.status(400).render('job-form', { mode: 'edit', action: `/jobs/${job.id}`, job, values, errors });
  }

  db.prepare(`
    UPDATE jobs
    SET title = ?, company = ?, location = ?, description = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ?
  `).run(values.title, values.company, values.location, values.description, job.id, req.session.user.id);
  res.redirect('/');
});

app.post('/jobs/:id/delete', requireAuth, (req, res) => {
  db.prepare('DELETE FROM jobs WHERE id = ? AND user_id = ?').run(req.params.id, req.session.user.id);
  res.redirect('/');
});

app.use((req, res) => res.status(404).render('not-found'));

app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).render('error', { message: 'Invalid or expired form token.' });
  }
  console.error(err);
  return res.status(500).render('error', { message: 'Something went wrong.' });
});

app.listen(PORT, () => {
  console.log(`Job board listening on port ${PORT}`);
});
