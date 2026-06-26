const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const cookieParser = require('cookie-parser');
const express = require('express');
const Database = require('better-sqlite3');

const app = express();
const port = Number(process.env.PORT || 5065);
const dataDir = path.join(__dirname, 'data');
const dbPath = process.env.DATABASE_PATH || path.join(dataDir, 'qa.sqlite');

fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    author TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    accepted_answer_id INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (accepted_answer_id) REFERENCES answers(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id INTEGER NOT NULL,
    body TEXT NOT NULL,
    author TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    visitor_id TEXT NOT NULL,
    target_type TEXT NOT NULL CHECK (target_type IN ('question', 'answer')),
    target_id INTEGER NOT NULL,
    value INTEGER NOT NULL CHECK (value IN (-1, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(visitor_id, target_type, target_id)
  );
`);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
  let visitorId = req.cookies.visitor_id;
  if (!visitorId || !/^[a-f0-9-]{36}$/i.test(visitorId)) {
    visitorId = crypto.randomUUID();
    res.cookie('visitor_id', visitorId, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 365
    });
  }
  req.visitorId = visitorId;
  res.locals.visitorId = visitorId;
  next();
});

function cleanText(value, maxLength) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function cleanBody(value, maxLength) {
  return String(value || '').trim().replace(/\r\n/g, '\n').slice(0, maxLength);
}

function getQuestion(id) {
  return db.prepare(`
    SELECT
      q.*,
      COALESCE(SUM(CASE WHEN v.target_type = 'question' THEN v.value ELSE 0 END), 0) AS score,
      COUNT(DISTINCT a.id) AS answer_count
    FROM questions q
    LEFT JOIN votes v ON v.target_type = 'question' AND v.target_id = q.id
    LEFT JOIN answers a ON a.question_id = q.id
    WHERE q.id = ?
    GROUP BY q.id
  `).get(id);
}

function voteFor(visitorId, targetType, targetId, value) {
  db.prepare(`
    INSERT INTO votes (visitor_id, target_type, target_id, value)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(visitor_id, target_type, target_id)
    DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run(visitorId, targetType, targetId, value);
}

app.get('/', (req, res) => {
  const questions = db.prepare(`
    SELECT
      q.*,
      COALESCE(SUM(CASE WHEN v.target_type = 'question' THEN v.value ELSE 0 END), 0) AS score,
      COUNT(DISTINCT a.id) AS answer_count
    FROM questions q
    LEFT JOIN votes v ON v.target_type = 'question' AND v.target_id = q.id
    LEFT JOIN answers a ON a.question_id = q.id
    GROUP BY q.id
    ORDER BY q.created_at DESC
  `).all();

  res.render('index', { questions, error: null, values: {} });
});

app.post('/questions', (req, res) => {
  const title = cleanText(req.body.title, 160);
  const body = cleanBody(req.body.body, 3000);
  const author = cleanText(req.body.author, 80) || 'Anonymous';

  if (!title || !body) {
    const questions = db.prepare(`
      SELECT q.*, 0 AS score, COUNT(a.id) AS answer_count
      FROM questions q
      LEFT JOIN answers a ON a.question_id = q.id
      GROUP BY q.id
      ORDER BY q.created_at DESC
    `).all();
    return res.status(400).render('index', {
      questions,
      error: 'A question needs both a title and details.',
      values: { title, body, author }
    });
  }

  const result = db.prepare(`
    INSERT INTO questions (title, body, author, owner_id)
    VALUES (?, ?, ?, ?)
  `).run(title, body, author, req.visitorId);

  res.redirect(`/questions/${result.lastInsertRowid}`);
});

app.get('/questions/:id', (req, res) => {
  const question = getQuestion(req.params.id);
  if (!question) {
    return res.status(404).render('not-found');
  }

  const answers = db.prepare(`
    SELECT
      a.*,
      COALESCE(SUM(CASE WHEN v.target_type = 'answer' THEN v.value ELSE 0 END), 0) AS score
    FROM answers a
    LEFT JOIN votes v ON v.target_type = 'answer' AND v.target_id = a.id
    WHERE a.question_id = ?
    GROUP BY a.id
    ORDER BY score DESC, a.created_at ASC
  `).all(question.id);

  res.render('question', { question, answers, error: null, values: {} });
});

app.post('/questions/:id/answers', (req, res) => {
  const question = getQuestion(req.params.id);
  if (!question) {
    return res.status(404).render('not-found');
  }

  const body = cleanBody(req.body.body, 3000);
  const author = cleanText(req.body.author, 80) || 'Anonymous';

  if (!body) {
    const answers = db.prepare(`
      SELECT a.*, COALESCE(SUM(v.value), 0) AS score
      FROM answers a
      LEFT JOIN votes v ON v.target_type = 'answer' AND v.target_id = a.id
      WHERE a.question_id = ?
      GROUP BY a.id
      ORDER BY score DESC, a.created_at ASC
    `).all(question.id);
    return res.status(400).render('question', {
      question,
      answers,
      error: 'An answer cannot be empty.',
      values: { body, author }
    });
  }

  db.prepare(`
    INSERT INTO answers (question_id, body, author, owner_id)
    VALUES (?, ?, ?, ?)
  `).run(question.id, body, author, req.visitorId);

  res.redirect(`/questions/${question.id}`);
});

app.post('/questions/:questionId/accept/:answerId', (req, res) => {
  const question = getQuestion(req.params.questionId);
  if (!question) {
    return res.status(404).render('not-found');
  }
  if (question.owner_id !== req.visitorId) {
    return res.status(403).send('Only the question author can accept an answer.');
  }

  const answer = db.prepare(`
    SELECT id FROM answers WHERE id = ? AND question_id = ?
  `).get(req.params.answerId, question.id);
  if (!answer) {
    return res.status(404).render('not-found');
  }

  const acceptedId = Number(question.accepted_answer_id) === Number(answer.id) ? null : answer.id;
  db.prepare('UPDATE questions SET accepted_answer_id = ? WHERE id = ?').run(acceptedId, question.id);
  res.redirect(`/questions/${question.id}`);
});

app.post('/vote', (req, res) => {
  const targetType = req.body.target_type === 'answer' ? 'answer' : 'question';
  const targetId = Number(req.body.target_id);
  const value = Number(req.body.value) === -1 ? -1 : 1;
  const redirectTo = String(req.body.redirect_to || '/');

  if (!Number.isInteger(targetId) || targetId < 1) {
    return res.status(400).send('Invalid vote target.');
  }

  if (targetType === 'question') {
    const exists = db.prepare('SELECT id FROM questions WHERE id = ?').get(targetId);
    if (!exists) return res.status(404).render('not-found');
  } else {
    const exists = db.prepare('SELECT id FROM answers WHERE id = ?').get(targetId);
    if (!exists) return res.status(404).render('not-found');
  }

  voteFor(req.visitorId, targetType, targetId, value);
  res.redirect(redirectTo.startsWith('/') ? redirectTo : '/');
});

app.use((req, res) => {
  res.status(404).render('not-found');
});

app.listen(port, () => {
  console.log(`Q&A site listening on http://localhost:${port}`);
});
