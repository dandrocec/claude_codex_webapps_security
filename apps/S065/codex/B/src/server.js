const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const express = require('express');
const session = require('express-session');
const SQLiteStoreFactory = require('connect-sqlite3');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const sanitizeHtml = require('sanitize-html');
const { body, validationResult } = require('express-validator');
const db = require('./db');

const app = express();
const SQLiteStore = SQLiteStoreFactory(session);
const PORT = Number(process.env.PORT || 5065);
const isProduction = process.env.NODE_ENV === 'production';
const sessionSecret = process.env.SESSION_SECRET || 'local-development-secret-change-me';
const dataDir = path.join(__dirname, '..', 'data');

fs.mkdirSync(dataDir, { recursive: true });

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');
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
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', etag: true }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false }));
app.use(session({
  name: 'qa.sid',
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: dataDir }),
  cookie: {
    httpOnly: true,
    secure: process.env.SESSION_COOKIE_SECURE === 'true' || isProduction,
    sameSite: 'strict',
    maxAge: 1000 * 60 * 60 * 4
  }
}));

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.errors = [];
  res.locals.form = {};
  res.locals.csrfToken = req.session.csrfToken || crypto.randomBytes(32).toString('hex');
  req.session.csrfToken = res.locals.csrfToken;
  next();
});

app.use((req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const sentToken = Buffer.from(String(req.body._csrf || ''));
  const storedToken = Buffer.from(String(req.session.csrfToken || ''));
  if (sentToken.length === storedToken.length && crypto.timingSafeEqual(sentToken, storedToken)) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    res.locals.csrfToken = req.session.csrfToken;
    return next();
  }
  return res.status(403).render('error', { title: 'Forbidden', message: 'Invalid security token.' });
});

function cleanText(value) {
  return sanitizeHtml(String(value || '').trim(), { allowedTags: [], allowedAttributes: {} });
}

function requireAuth(req, res, next) {
  if (req.session.user) return next();
  return res.redirect('/login');
}

function collectErrors(req) {
  return validationResult(req).array().map((error) => error.msg);
}

function renderWithValidation(req, res, view, title, status = 400) {
  return res.status(status).render(view, {
    title,
    errors: collectErrors(req),
    form: req.body
  });
}

const userFields = [
  body('username')
    .trim()
    .isLength({ min: 3, max: 30 }).withMessage('Username must be 3 to 30 characters.')
    .matches(/^[a-zA-Z0-9_-]+$/).withMessage('Username may contain letters, numbers, underscores, and hyphens only.'),
  body('password')
    .isLength({ min: 10, max: 128 }).withMessage('Password must be 10 to 128 characters.')
];

const questionFields = [
  body('title').customSanitizer(cleanText).isLength({ min: 8, max: 160 }).withMessage('Title must be 8 to 160 characters.'),
  body('body').customSanitizer(cleanText).isLength({ min: 20, max: 5000 }).withMessage('Question details must be 20 to 5000 characters.')
];

const answerFields = [
  body('body').customSanitizer(cleanText).isLength({ min: 10, max: 5000 }).withMessage('Answer must be 10 to 5000 characters.')
];

app.get('/', (req, res) => {
  const questions = db.prepare(`
    SELECT q.id, q.title, q.body, q.created_at, u.username,
      COUNT(DISTINCT a.id) AS answer_count,
      COALESCE(SUM(v.value), 0) AS score
    FROM questions q
    JOIN users u ON u.id = q.user_id
    LEFT JOIN answers a ON a.question_id = q.id
    LEFT JOIN answer_votes v ON v.answer_id = a.id
    GROUP BY q.id
    ORDER BY q.created_at DESC
  `).all();
  res.render('index', { title: 'Questions', questions });
});

app.get('/register', (req, res) => res.render('register', { title: 'Register' }));

app.post('/register', userFields, async (req, res, next) => {
  try {
    if (!validationResult(req).isEmpty()) return renderWithValidation(req, res, 'register', 'Register');
    const passwordHash = await bcrypt.hash(req.body.password, 12);
    const result = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(req.body.username, passwordHash);
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = { id: result.lastInsertRowid, username: req.body.username };
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');
      return res.redirect('/');
    });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).render('register', { title: 'Register', errors: ['That username is already taken.'], form: req.body });
    }
    return next(error);
  }
});

app.get('/login', (req, res) => res.render('login', { title: 'Log in' }));

app.post('/login', userFields, async (req, res, next) => {
  try {
    if (!validationResult(req).isEmpty()) return renderWithValidation(req, res, 'login', 'Log in');
    const user = db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(req.body.username);
    const valid = user && await bcrypt.compare(req.body.password, user.password_hash);
    if (!valid) {
      return res.status(401).render('login', { title: 'Log in', errors: ['Invalid username or password.'], form: { username: req.body.username } });
    }
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = { id: user.id, username: user.username };
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');
      return res.redirect('/');
    });
  } catch (error) {
    return next(error);
  }
});

app.post('/logout', requireAuth, (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('qa.sid');
    return res.redirect('/');
  });
});

app.get('/questions/new', requireAuth, (req, res) => res.render('question-form', { title: 'Ask a question' }));

app.post('/questions', requireAuth, questionFields, (req, res, next) => {
  try {
    if (!validationResult(req).isEmpty()) return renderWithValidation(req, res, 'question-form', 'Ask a question');
    const result = db.prepare('INSERT INTO questions (user_id, title, body) VALUES (?, ?, ?)').run(req.session.user.id, req.body.title, req.body.body);
    return res.redirect(`/questions/${result.lastInsertRowid}`);
  } catch (error) {
    return next(error);
  }
});

app.get('/questions/:id', (req, res, next) => {
  try {
    const question = db.prepare(`
      SELECT q.*, u.username
      FROM questions q
      JOIN users u ON u.id = q.user_id
      WHERE q.id = ?
    `).get(req.params.id);
    if (!question) return res.status(404).render('error', { title: 'Not found', message: 'Question not found.' });

    const answers = db.prepare(`
      SELECT a.id, a.body, a.created_at, a.user_id, u.username,
        COALESCE(SUM(v.value), 0) AS score,
        MAX(CASE WHEN v.user_id = ? THEN v.value ELSE 0 END) AS current_user_vote
      FROM answers a
      JOIN users u ON u.id = a.user_id
      LEFT JOIN answer_votes v ON v.answer_id = a.id
      WHERE a.question_id = ?
      GROUP BY a.id
      ORDER BY score DESC, a.created_at ASC
    `).all(req.session.user?.id || 0, question.id);

    return res.render('question', { title: question.title, question, answers });
  } catch (error) {
    return next(error);
  }
});

app.post('/questions/:id/answers', requireAuth, answerFields, (req, res, next) => {
  try {
    const question = db.prepare('SELECT id FROM questions WHERE id = ?').get(req.params.id);
    if (!question) return res.status(404).render('error', { title: 'Not found', message: 'Question not found.' });
    if (!validationResult(req).isEmpty()) {
      const answers = db.prepare(`
        SELECT a.id, a.body, a.created_at, a.user_id, u.username, COALESCE(SUM(v.value), 0) AS score, 0 AS current_user_vote
        FROM answers a JOIN users u ON u.id = a.user_id LEFT JOIN answer_votes v ON v.answer_id = a.id
        WHERE a.question_id = ?
        GROUP BY a.id
        ORDER BY score DESC, a.created_at ASC
      `).all(question.id);
      const fullQuestion = db.prepare('SELECT q.*, u.username FROM questions q JOIN users u ON u.id = q.user_id WHERE q.id = ?').get(question.id);
      return res.status(400).render('question', { title: fullQuestion.title, question: fullQuestion, answers, errors: collectErrors(req), form: req.body });
    }
    db.prepare('INSERT INTO answers (question_id, user_id, body) VALUES (?, ?, ?)').run(question.id, req.session.user.id, req.body.body);
    return res.redirect(`/questions/${question.id}`);
  } catch (error) {
    return next(error);
  }
});

app.post('/answers/:id/vote', requireAuth, [
  body('value').isIn(['-1', '1']).withMessage('Vote must be up or down.')
], (req, res, next) => {
  try {
    if (!validationResult(req).isEmpty()) return res.status(400).render('error', { title: 'Bad request', message: 'Invalid vote.' });
    const answer = db.prepare('SELECT id, question_id FROM answers WHERE id = ?').get(req.params.id);
    if (!answer) return res.status(404).render('error', { title: 'Not found', message: 'Answer not found.' });
    db.prepare(`
      INSERT INTO answer_votes (answer_id, user_id, value)
      VALUES (?, ?, ?)
      ON CONFLICT(answer_id, user_id) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).run(answer.id, req.session.user.id, Number(req.body.value));
    return res.redirect(`/questions/${answer.question_id}`);
  } catch (error) {
    return next(error);
  }
});

app.post('/answers/:id/accept', requireAuth, (req, res, next) => {
  try {
    const answer = db.prepare(`
      SELECT a.id, a.question_id, q.user_id AS question_owner_id
      FROM answers a
      JOIN questions q ON q.id = a.question_id
      WHERE a.id = ?
    `).get(req.params.id);
    if (!answer) return res.status(404).render('error', { title: 'Not found', message: 'Answer not found.' });
    if (answer.question_owner_id !== req.session.user.id) {
      return res.status(403).render('error', { title: 'Forbidden', message: 'Only the question owner can accept an answer.' });
    }
    db.prepare('UPDATE questions SET accepted_answer_id = ? WHERE id = ? AND user_id = ?').run(answer.id, answer.question_id, req.session.user.id);
    return res.redirect(`/questions/${answer.question_id}`);
  } catch (error) {
    return next(error);
  }
});

app.use((req, res) => {
  res.status(404).render('error', { title: 'Not found', message: 'Page not found.' });
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  return res.status(500).render('error', { title: 'Server error', message: 'Something went wrong.' });
});

app.listen(PORT, () => {
  console.log(`Q&A site listening on port ${PORT}`);
});
