require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const SQLiteStore = require('connect-sqlite3')(session);
const { getDb } = require('./db');
const {
  cleanText,
  currentUser,
  ensureCsrfToken,
  redirectIfAuthenticated,
  requireAuth,
  requireCsrf,
  validEmail
} = require('./security');

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET must be set to at least 32 characters.');
}

const app = express();
const port = Number(process.env.PORT || 5055);
const isProduction = process.env.NODE_ENV === 'production';
const cookieSecure = process.env.COOKIE_SECURE === 'true' || isProduction;
const databaseFile = process.env.DATABASE_FILE || './data/app.sqlite';
const databaseDir = path.dirname(path.resolve(databaseFile));

fs.mkdirSync(databaseDir, { recursive: true });

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"]
    }
  }
}));
app.use(express.urlencoded({ extended: false, limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public'), { fallthrough: true }));
app.use(session({
  store: new SQLiteStore({
    db: 'sessions.sqlite',
    dir: databaseDir
  }),
  name: 'survey.sid',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 8
  }
}));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false
}));
app.use('/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false }));
app.use('/register', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false }));
app.use(ensureCsrfToken);
app.use(currentUser);

function flash(req, type, message) {
  req.session.flash = { type, message };
}

function viewData(req, extra = {}) {
  const data = { flash: req.session.flash || null, ...extra };
  delete req.session.flash;
  return data;
}

async function loadOwnedSurvey(req, res, next) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(404).render('error', { message: 'Survey not found.' });
  }

  const db = await getDb();
  const survey = await db.get('SELECT * FROM surveys WHERE id = ? AND user_id = ?', id, req.session.userId);
  if (!survey) {
    return res.status(404).render('error', { message: 'Survey not found.' });
  }
  req.survey = survey;
  next();
}

app.get('/', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.redirect('/login');
});

app.get('/register', redirectIfAuthenticated, (req, res) => {
  res.render('register', viewData(req));
});

app.post('/register', redirectIfAuthenticated, requireCsrf, async (req, res) => {
  const email = cleanText(req.body.email, 254).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';

  if (!validEmail(email) || password.length < 12 || password.length > 128) {
    flash(req, 'error', 'Use a valid email and a password of at least 12 characters.');
    return res.redirect('/register');
  }

  const db = await getDb();
  const passwordHash = await bcrypt.hash(password, 12);

  try {
    const result = await db.run('INSERT INTO users (email, password_hash) VALUES (?, ?)', email, passwordHash);
    req.session.regenerate((err) => {
      if (err) throw err;
      req.session.userId = result.lastID;
      req.session.user = { email };
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');
      res.redirect('/dashboard');
    });
  } catch (err) {
    flash(req, 'error', 'An account with that email may already exist.');
    res.redirect('/register');
  }
});

app.get('/login', redirectIfAuthenticated, (req, res) => {
  res.render('login', viewData(req));
});

app.post('/login', redirectIfAuthenticated, requireCsrf, async (req, res) => {
  const email = cleanText(req.body.email, 254).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';

  const db = await getDb();
  const user = validEmail(email)
    ? await db.get('SELECT id, email, password_hash FROM users WHERE email = ?', email)
    : null;
  const ok = user ? await bcrypt.compare(password, user.password_hash) : false;

  if (!ok) {
    flash(req, 'error', 'Invalid email or password.');
    return res.redirect('/login');
  }

  req.session.regenerate((err) => {
    if (err) throw err;
    req.session.userId = user.id;
    req.session.user = { email: user.email };
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    res.redirect('/dashboard');
  });
});

app.post('/logout', requireAuth, requireCsrf, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('survey.sid');
    res.redirect('/login');
  });
});

app.get('/dashboard', requireAuth, async (req, res) => {
  const db = await getDb();
  const surveys = await db.all(
    `SELECT s.*, COUNT(DISTINCT r.id) AS response_count
     FROM surveys s
     LEFT JOIN responses r ON r.survey_id = s.id
     WHERE s.user_id = ?
     GROUP BY s.id
     ORDER BY s.created_at DESC`,
    req.session.userId
  );
  res.render('dashboard', viewData(req, { surveys }));
});

app.get('/surveys/new', requireAuth, (req, res) => {
  res.render('survey_new', viewData(req));
});

app.post('/surveys', requireAuth, requireCsrf, async (req, res) => {
  const title = cleanText(req.body.title, 120);
  const description = cleanText(req.body.description, 800);
  const prompts = Array.isArray(req.body.questions) ? req.body.questions : [req.body.questions];
  const questions = prompts.map((q) => cleanText(q, 240)).filter(Boolean).slice(0, 20);

  if (!title || questions.length === 0) {
    flash(req, 'error', 'A survey needs a title and at least one question.');
    return res.redirect('/surveys/new');
  }

  const db = await getDb();
  const token = crypto.randomBytes(24).toString('base64url');
  await db.exec('BEGIN');
  try {
    const result = await db.run(
      'INSERT INTO surveys (user_id, title, description, public_token) VALUES (?, ?, ?, ?)',
      req.session.userId,
      title,
      description,
      token
    );
    for (let i = 0; i < questions.length; i += 1) {
      await db.run(
        'INSERT INTO questions (survey_id, prompt, position) VALUES (?, ?, ?)',
        result.lastID,
        questions[i],
        i + 1
      );
    }
    await db.exec('COMMIT');
    res.redirect(`/surveys/${result.lastID}`);
  } catch (err) {
    await db.exec('ROLLBACK');
    flash(req, 'error', 'Unable to create the survey.');
    res.redirect('/surveys/new');
  }
});

app.get('/surveys/:id', requireAuth, loadOwnedSurvey, async (req, res) => {
  const db = await getDb();
  const questions = await db.all('SELECT * FROM questions WHERE survey_id = ? ORDER BY position ASC', req.survey.id);
  const shareUrl = `${req.protocol}://${req.get('host')}/s/${req.survey.public_token}`;
  res.render('survey_show', viewData(req, { survey: req.survey, questions, shareUrl }));
});

app.get('/surveys/:id/responses', requireAuth, loadOwnedSurvey, async (req, res) => {
  const db = await getDb();
  const questions = await db.all('SELECT * FROM questions WHERE survey_id = ? ORDER BY position ASC', req.survey.id);
  const responses = await db.all('SELECT * FROM responses WHERE survey_id = ? ORDER BY created_at DESC', req.survey.id);
  const answers = await db.all(
    `SELECT a.response_id, a.question_id, a.answer_text
     FROM answers a
     JOIN responses r ON r.id = a.response_id
     WHERE r.survey_id = ?`,
    req.survey.id
  );
  const answerMap = new Map();
  for (const answer of answers) {
    answerMap.set(`${answer.response_id}:${answer.question_id}`, answer.answer_text);
  }
  res.render('responses', viewData(req, { survey: req.survey, questions, responses, answerMap }));
});

app.get('/s/:token', async (req, res) => {
  const token = cleanText(req.params.token, 80);
  const db = await getDb();
  const survey = await db.get('SELECT id, title, description FROM surveys WHERE public_token = ?', token);
  if (!survey) return res.status(404).render('error', { message: 'Survey not found.' });
  const questions = await db.all('SELECT id, prompt FROM questions WHERE survey_id = ? ORDER BY position ASC', survey.id);
  res.render('public_survey', viewData(req, { survey, token, questions }));
});

app.post('/s/:token', requireCsrf, async (req, res) => {
  const token = cleanText(req.params.token, 80);
  const db = await getDb();
  const survey = await db.get('SELECT id, title FROM surveys WHERE public_token = ?', token);
  if (!survey) return res.status(404).render('error', { message: 'Survey not found.' });

  const questions = await db.all('SELECT id FROM questions WHERE survey_id = ? ORDER BY position ASC', survey.id);
  const answers = questions.map((q) => ({
    questionId: q.id,
    text: cleanText(req.body[`q_${q.id}`], 2000)
  }));

  if (answers.some((a) => !a.text)) {
    flash(req, 'error', 'Please answer every question.');
    return res.redirect(`/s/${token}`);
  }

  await db.exec('BEGIN');
  try {
    const response = await db.run('INSERT INTO responses (survey_id) VALUES (?)', survey.id);
    for (const answer of answers) {
      await db.run(
        'INSERT INTO answers (response_id, question_id, answer_text) VALUES (?, ?, ?)',
        response.lastID,
        answer.questionId,
        answer.text
      );
    }
    await db.exec('COMMIT');
    res.render('thanks', viewData(req, { survey }));
  } catch (err) {
    await db.exec('ROLLBACK');
    res.status(500).render('error', { message: 'Unable to save the response.' });
  }
});

app.use((req, res) => {
  res.status(404).render('error', { message: 'Page not found.' });
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).render('error', { message: 'Something went wrong.' });
});

getDb().then(() => {
  app.listen(port, () => {
    console.log(`Survey builder listening on port ${port}`);
  });
}).catch((err) => {
  console.error('Failed to initialize application.');
  console.error(err);
  process.exit(1);
});
