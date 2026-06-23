'use strict';

const path = require('path');
const express = require('express');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 5075;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Prepared statements
// ---------------------------------------------------------------------------
const stmts = {
  insertQuiz: db.prepare('INSERT INTO quizzes (title) VALUES (?)'),
  insertQuestion: db.prepare(
    'INSERT INTO questions (quiz_id, text, position) VALUES (?, ?, ?)'
  ),
  insertOption: db.prepare(
    'INSERT INTO options (question_id, text, is_correct, position) VALUES (?, ?, ?, ?)'
  ),
  listQuizzes: db.prepare(`
    SELECT q.id, q.title, q.created_at,
           (SELECT COUNT(*) FROM questions WHERE quiz_id = q.id) AS question_count
    FROM quizzes q
    ORDER BY q.created_at DESC, q.id DESC
  `),
  getQuiz: db.prepare('SELECT id, title FROM quizzes WHERE id = ?'),
  getQuestions: db.prepare(
    'SELECT id, text FROM questions WHERE quiz_id = ? ORDER BY position, id'
  ),
  // NOTE: is_correct is intentionally NOT selected here. The options sent to a
  // student taking the quiz must never include which answer is correct.
  getOptionsForStudent: db.prepare(
    'SELECT id, text FROM options WHERE question_id = ? ORDER BY position, id'
  ),
  // Used only during grading, on the server, after submission.
  getCorrectOption: db.prepare(
    'SELECT id FROM options WHERE question_id = ? AND is_correct = 1 LIMIT 1'
  )
};

// Create a quiz (with its questions and options) in a single transaction.
const createQuizTx = db.transaction((title, questions) => {
  const quizId = stmts.insertQuiz.run(title).lastInsertRowid;

  questions.forEach((question, qIndex) => {
    const questionId = stmts.insertQuestion.run(
      quizId,
      question.text,
      qIndex
    ).lastInsertRowid;

    question.options.forEach((option, oIndex) => {
      stmts.insertOption.run(
        questionId,
        option.text,
        option.isCorrect ? 1 : 0,
        oIndex
      );
    });
  });

  return quizId;
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
function validateQuizPayload(body) {
  const errors = [];
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) errors.push('A quiz title is required.');

  if (!Array.isArray(body.questions) || body.questions.length === 0) {
    errors.push('A quiz needs at least one question.');
    return { errors, title, questions: [] };
  }

  const questions = body.questions.map((q, i) => {
    const text = typeof q.text === 'string' ? q.text.trim() : '';
    if (!text) errors.push(`Question ${i + 1} is missing its text.`);

    const rawOptions = Array.isArray(q.options) ? q.options : [];
    const options = rawOptions
      .map((o) => ({
        text: typeof o.text === 'string' ? o.text.trim() : '',
        isCorrect: Boolean(o.isCorrect)
      }))
      .filter((o) => o.text !== '');

    if (options.length < 2) {
      errors.push(`Question ${i + 1} needs at least two answer options.`);
    }
    const correctCount = options.filter((o) => o.isCorrect).length;
    if (correctCount !== 1) {
      errors.push(`Question ${i + 1} must have exactly one correct answer.`);
    }

    return { text, options };
  });

  return { errors, title, questions };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Home: list available quizzes.
app.get('/', (req, res) => {
  const quizzes = stmts.listQuizzes.all();
  res.render('home', { quizzes });
});

// Teacher: quiz creation form.
app.get('/teacher/new', (req, res) => {
  res.render('teacher-new');
});

// Teacher: create a quiz (JSON API consumed by the creation form).
app.post('/teacher/quizzes', (req, res) => {
  const { errors, title, questions } = validateQuizPayload(req.body);
  if (errors.length > 0) {
    return res.status(400).json({ errors });
  }
  const quizId = createQuizTx(title, questions);
  res.status(201).json({ id: quizId });
});

// Student: take a quiz. Correct answers are never sent to the client.
app.get('/quiz/:id', (req, res) => {
  const quiz = stmts.getQuiz.get(req.params.id);
  if (!quiz) return res.status(404).render('not-found');

  const questions = stmts.getQuestions.all(quiz.id).map((q) => ({
    id: q.id,
    text: q.text,
    options: stmts.getOptionsForStudent.all(q.id)
  }));

  res.render('take-quiz', { quiz, questions });
});

// Student: submit answers and receive an automatically computed score.
app.post('/quiz/:id/submit', (req, res) => {
  const quiz = stmts.getQuiz.get(req.params.id);
  if (!quiz) return res.status(404).render('not-found');

  const questions = stmts.getQuestions.all(quiz.id);
  const submitted = req.body || {};

  let correct = 0;
  const review = questions.map((q) => {
    const correctOption = stmts.getCorrectOption.get(q.id);
    // Form fields are named "question_<id>" with the chosen option id as value.
    const chosenId = Number(submitted[`question_${q.id}`]);
    const isCorrect = correctOption && chosenId === correctOption.id;
    if (isCorrect) correct += 1;
    return { text: q.text, isCorrect: Boolean(isCorrect) };
  });

  const total = questions.length;
  const percent = total > 0 ? Math.round((correct / total) * 100) : 0;

  res.render('result', { quiz, correct, total, percent, review });
});

app.use((req, res) => {
  res.status(404).render('not-found');
});

app.listen(PORT, () => {
  console.log(`Quiz platform running at http://localhost:${PORT}`);
});
