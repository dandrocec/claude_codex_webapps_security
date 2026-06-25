require('dotenv').config();

const crypto = require('crypto');
const path = require('path');
const bcrypt = require('bcrypt');
const express = require('express');
const session = require('express-session');
const SQLiteStoreFactory = require('connect-sqlite3');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const db = require('./db');
const { csrfProtection, requireAuth, requireGuest } = require('./security');

const app = express();
const SQLiteStore = SQLiteStoreFactory(session);
const port = Number.parseInt(process.env.PORT || '5041', 10);
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(48).toString('hex');
const cookieSecure = process.env.COOKIE_SECURE === 'false' ? false : true;

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
  },
  referrerPolicy: { policy: 'no-referrer' }
}));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  maxAge: '1h',
  index: false
}));
app.use(session({
  name: 'faq.sid',
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
    maxAge: 1000 * 60 * 60 * 8
  }
}));
app.use(csrfProtection);
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.currentPath = req.path;
  next();
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 25,
  standardHeaders: true,
  legacyHeaders: false
});

const faqValidators = [
  body('category').trim().customSanitizer(cleanText).isLength({ min: 1, max: 80 }).withMessage('Category is required and must be 80 characters or fewer.'),
  body('question').trim().customSanitizer(cleanText).isLength({ min: 3, max: 240 }).withMessage('Question must be between 3 and 240 characters.'),
  body('answer').trim().customSanitizer(cleanText).isLength({ min: 3, max: 4000 }).withMessage('Answer must be between 3 and 4000 characters.'),
  body('position').optional({ values: 'falsy' }).isInt({ min: 0, max: 100000 }).withMessage('Position must be a non-negative number.')
];

const credentialsValidators = [
  body('email').trim().isEmail().normalizeEmail().isLength({ max: 254 }).withMessage('Enter a valid email address.'),
  body('password').isLength({ min: 12, max: 128 }).withMessage('Password must be between 12 and 128 characters.')
];

function hasUsers() {
  return db.prepare('SELECT COUNT(*) AS total FROM users').get().total > 0;
}

function cleanText(value) {
  return String(value || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

function renderWithErrors(res, view, status, data, errors) {
  return res.status(status).render(view, {
    ...data,
    errors: errors.array ? errors.array() : errors
  });
}

function groupedFaqs(keyword) {
  const term = `%${keyword.toLowerCase()}%`;
  const rows = keyword
    ? db.prepare(`
        SELECT category, question, answer
        FROM faqs
        WHERE lower(category) LIKE ? OR lower(question) LIKE ? OR lower(answer) LIKE ?
        ORDER BY lower(category), position, id
      `).all(term, term, term)
    : db.prepare(`
        SELECT category, question, answer
        FROM faqs
        ORDER BY lower(category), position, id
      `).all();

  return rows.reduce((groups, faq) => {
    let group = groups.find((item) => item.category === faq.category);
    if (!group) {
      group = { category: faq.category, faqs: [] };
      groups.push(group);
    }
    group.faqs.push(faq);
    return groups;
  }, []);
}

app.get('/', (req, res) => {
  const keyword = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  res.render('public', {
    title: 'FAQ',
    keyword,
    groups: groupedFaqs(keyword)
  });
});

app.get('/setup', requireGuest, (req, res) => {
  if (hasUsers()) {
    return res.redirect('/login');
  }
  res.render('setup', { title: 'Create editor', errors: [], values: {} });
});

app.post('/setup', requireGuest, authLimiter, credentialsValidators, async (req, res, next) => {
  try {
    if (hasUsers()) {
      return res.status(403).render('error', {
        title: 'Forbidden',
        message: 'Initial setup has already been completed.'
      });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return renderWithErrors(res, 'setup', 422, {
        title: 'Create editor',
        values: { email: req.body.email }
      }, errors);
    }

    const hash = await bcrypt.hash(req.body.password, 12);
    const result = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(req.body.email, hash);
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = { id: result.lastInsertRowid, email: req.body.email };
      res.redirect('/editor');
    });
  } catch (err) {
    next(err);
  }
});

app.get('/login', requireGuest, (req, res) => {
  res.render('login', { title: 'Editor login', errors: [], values: {} });
});

app.post('/login', requireGuest, authLimiter, credentialsValidators, async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return renderWithErrors(res, 'login', 422, {
        title: 'Editor login',
        values: { email: req.body.email }
      }, errors);
    }

    const user = db.prepare('SELECT id, email, password_hash FROM users WHERE email = ?').get(req.body.email);
    const ok = user ? await bcrypt.compare(req.body.password, user.password_hash) : false;
    if (!ok) {
      return res.status(401).render('login', {
        title: 'Editor login',
        errors: [{ msg: 'Invalid email or password.' }],
        values: { email: req.body.email }
      });
    }

    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = { id: user.id, email: user.email };
      res.redirect('/editor');
    });
  } catch (err) {
    next(err);
  }
});

app.post('/logout', requireAuth, (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('faq.sid');
    res.redirect('/');
  });
});

app.get('/editor', requireAuth, (req, res) => {
  const faqs = db.prepare(`
    SELECT id, category, question, answer, position
    FROM faqs
    WHERE user_id = ?
    ORDER BY position, id
  `).all(req.session.user.id);

  res.render('editor', {
    title: 'FAQ editor',
    faqs,
    editing: null,
    errors: [],
    values: {}
  });
});

app.post('/editor/faqs', requireAuth, faqValidators, (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const faqs = db.prepare('SELECT id, category, question, answer, position FROM faqs WHERE user_id = ? ORDER BY position, id').all(req.session.user.id);
    return renderWithErrors(res, 'editor', 422, {
      title: 'FAQ editor',
      faqs,
      editing: null,
      values: req.body
    }, errors);
  }

  const position = req.body.position === '' ? 0 : Number.parseInt(req.body.position, 10);
  db.prepare(`
    INSERT INTO faqs (user_id, category, question, answer, position, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(req.session.user.id, req.body.category, req.body.question, req.body.answer, position);
  res.redirect('/editor');
});

app.get('/editor/faqs/:id/edit', requireAuth, (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.redirect('/editor');

  const editing = db.prepare('SELECT id, category, question, answer, position FROM faqs WHERE id = ? AND user_id = ?').get(id, req.session.user.id);
  if (!editing) {
    return res.status(404).render('error', {
      title: 'Not found',
      message: 'FAQ item was not found.'
    });
  }

  const faqs = db.prepare('SELECT id, category, question, answer, position FROM faqs WHERE user_id = ? ORDER BY position, id').all(req.session.user.id);
  res.render('editor', {
    title: 'Edit FAQ',
    faqs,
    editing,
    errors: [],
    values: editing
  });
});

app.post('/editor/faqs/:id', requireAuth, faqValidators, (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.redirect('/editor');

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const faqs = db.prepare('SELECT id, category, question, answer, position FROM faqs WHERE user_id = ? ORDER BY position, id').all(req.session.user.id);
    return renderWithErrors(res, 'editor', 422, {
      title: 'Edit FAQ',
      faqs,
      editing: { id, ...req.body },
      values: req.body
    }, errors);
  }

  const position = req.body.position === '' ? 0 : Number.parseInt(req.body.position, 10);
  const result = db.prepare(`
    UPDATE faqs
    SET category = ?, question = ?, answer = ?, position = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ?
  `).run(req.body.category, req.body.question, req.body.answer, position, id, req.session.user.id);

  if (result.changes === 0) {
    return res.status(404).render('error', {
      title: 'Not found',
      message: 'FAQ item was not found.'
    });
  }
  res.redirect('/editor');
});

app.post('/editor/faqs/:id/delete', requireAuth, (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (Number.isInteger(id)) {
    db.prepare('DELETE FROM faqs WHERE id = ? AND user_id = ?').run(id, req.session.user.id);
  }
  res.redirect('/editor');
});

app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Not found',
    message: 'The requested page was not found.'
  });
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).render('error', {
    title: 'Server error',
    message: 'Something went wrong. Please try again later.'
  });
});

app.listen(port, () => {
  console.log(`FAQ app listening on port ${port}`);
});
