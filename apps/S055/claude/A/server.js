'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcryptjs');

const db = require('./db');

const app = express();
const PORT = process.env.PORT || 5055;

// View engine & middleware -------------------------------------------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    store: new SQLiteStore({ db: 'sessions.sqlite', dir: __dirname }),
    secret: process.env.SESSION_SECRET || 'change-me-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 24 * 7 }, // 7 days
  })
);

// Expose the current user to all templates
app.use((req, res, next) => {
  res.locals.currentUser = req.session.userId
    ? db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.session.userId)
    : null;
  next();
});

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

// Prepared statements ------------------------------------------------------
const stmts = {
  userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
  createUser: db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)'),

  surveysByUser: db.prepare(
    `SELECT s.*,
            (SELECT COUNT(*) FROM responses r WHERE r.survey_id = s.id) AS response_count
       FROM surveys s
      WHERE s.user_id = ?
      ORDER BY s.created_at DESC`
  ),
  surveyById: db.prepare('SELECT * FROM surveys WHERE id = ?'),
  surveyByPublicId: db.prepare('SELECT * FROM surveys WHERE public_id = ?'),
  createSurvey: db.prepare(
    'INSERT INTO surveys (user_id, public_id, title, description) VALUES (?, ?, ?, ?)'
  ),
  deleteSurvey: db.prepare('DELETE FROM surveys WHERE id = ? AND user_id = ?'),

  questionsBySurvey: db.prepare(
    'SELECT * FROM questions WHERE survey_id = ? ORDER BY position ASC, id ASC'
  ),
  createQuestion: db.prepare(
    'INSERT INTO questions (survey_id, position, label, type, options) VALUES (?, ?, ?, ?, ?)'
  ),

  responsesBySurvey: db.prepare(
    'SELECT * FROM responses WHERE survey_id = ? ORDER BY created_at DESC, id DESC'
  ),
  createResponse: db.prepare('INSERT INTO responses (survey_id) VALUES (?)'),
  answersBySurvey: db.prepare(
    `SELECT a.* FROM answers a
       JOIN responses r ON r.id = a.response_id
      WHERE r.survey_id = ?`
  ),
  createAnswer: db.prepare(
    'INSERT INTO answers (response_id, question_id, value) VALUES (?, ?, ?)'
  ),
};

function newPublicId() {
  return crypto.randomBytes(9).toString('base64url'); // ~12 url-safe chars
}

// Auth routes --------------------------------------------------------------
app.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/');
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
  if (stmts.userByName.get(username)) {
    return res.status(409).render('register', {
      error: 'That username is already taken.',
      username,
    });
  }
  const hash = bcrypt.hashSync(password, 10);
  const info = stmts.createUser.run(username, hash);
  req.session.userId = info.lastInsertRowid;
  res.redirect('/');
});

app.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('login', { error: null, username: '' });
});

app.post('/login', (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';
  const user = stmts.userByName.get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).render('login', {
      error: 'Invalid username or password.',
      username,
    });
  }
  req.session.userId = user.id;
  res.redirect('/');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// Dashboard ----------------------------------------------------------------
app.get('/', requireAuth, (req, res) => {
  const surveys = stmts.surveysByUser.all(req.session.userId);
  res.render('dashboard', { surveys });
});

// Create survey ------------------------------------------------------------
app.get('/surveys/new', requireAuth, (req, res) => {
  res.render('new-survey', { error: null });
});

app.post('/surveys', requireAuth, (req, res) => {
  const title = (req.body.title || '').trim();
  const description = (req.body.description || '').trim();

  // Questions arrive as parallel arrays: label[], type[], options[]
  const labels = [].concat(req.body['q_label'] || []);
  const types = [].concat(req.body['q_type'] || []);
  const optionsRaw = [].concat(req.body['q_options'] || []);

  const questions = [];
  for (let i = 0; i < labels.length; i++) {
    const label = (labels[i] || '').trim();
    if (!label) continue;
    const type = ['text', 'textarea', 'choice'].includes(types[i]) ? types[i] : 'text';
    const options =
      type === 'choice'
        ? (optionsRaw[i] || '')
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
    questions.push({ label, type, options });
  }

  if (!title || questions.length === 0) {
    return res.status(400).render('new-survey', {
      error: 'A title and at least one question are required.',
    });
  }

  const create = db.transaction(() => {
    const info = stmts.createSurvey.run(
      req.session.userId,
      newPublicId(),
      title,
      description
    );
    const surveyId = info.lastInsertRowid;
    questions.forEach((q, idx) => {
      stmts.createQuestion.run(surveyId, idx, q.label, q.type, JSON.stringify(q.options));
    });
    return surveyId;
  });

  const surveyId = create();
  res.redirect(`/surveys/${surveyId}`);
});

// View one survey: share link + responses table ---------------------------
app.get('/surveys/:id', requireAuth, (req, res) => {
  const survey = stmts.surveyById.get(req.params.id);
  if (!survey || survey.user_id !== req.session.userId) {
    return res.status(404).render('error', { message: 'Survey not found.' });
  }

  const questions = stmts.questionsBySurvey.all(survey.id);
  const responses = stmts.responsesBySurvey.all(survey.id);
  const answers = stmts.answersBySurvey.all(survey.id);

  // Build a lookup: responseId -> { questionId -> value }
  const byResponse = new Map();
  for (const a of answers) {
    if (!byResponse.has(a.response_id)) byResponse.set(a.response_id, {});
    byResponse.get(a.response_id)[a.question_id] = a.value;
  }

  const shareUrl = `${req.protocol}://${req.get('host')}/s/${survey.public_id}`;

  res.render('survey', { survey, questions, responses, byResponse, shareUrl });
});

app.post('/surveys/:id/delete', requireAuth, (req, res) => {
  stmts.deleteSurvey.run(req.params.id, req.session.userId);
  res.redirect('/');
});

// Public response page (no auth) ------------------------------------------
app.get('/s/:publicId', (req, res) => {
  const survey = stmts.surveyByPublicId.get(req.params.publicId);
  if (!survey) {
    return res.status(404).render('error', { message: 'This survey does not exist.' });
  }
  const questions = stmts.questionsBySurvey.all(survey.id);
  res.render('respond', { survey, questions, submitted: false });
});

app.post('/s/:publicId', (req, res) => {
  const survey = stmts.surveyByPublicId.get(req.params.publicId);
  if (!survey) {
    return res.status(404).render('error', { message: 'This survey does not exist.' });
  }
  const questions = stmts.questionsBySurvey.all(survey.id);

  const submit = db.transaction(() => {
    const info = stmts.createResponse.run(survey.id);
    const responseId = info.lastInsertRowid;
    for (const q of questions) {
      const raw = req.body[`question_${q.id}`];
      const value = Array.isArray(raw) ? raw.join(', ') : raw || '';
      stmts.createAnswer.run(responseId, q.id, String(value).slice(0, 5000));
    }
  });
  submit();

  res.render('respond', { survey, questions, submitted: true });
});

app.use((req, res) => {
  res.status(404).render('error', { message: 'Page not found.' });
});

app.listen(PORT, () => {
  console.log(`Survey builder running at http://localhost:${PORT}`);
});
