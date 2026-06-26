const express = require('express');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 5075;
const db = new Database(path.join(__dirname, 'quiz.db'));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS quizzes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quiz_id TEXT NOT NULL,
    prompt TEXT NOT NULL,
    option_a TEXT NOT NULL,
    option_b TEXT NOT NULL,
    option_c TEXT NOT NULL,
    option_d TEXT NOT NULL,
    correct_option TEXT NOT NULL CHECK (correct_option IN ('A', 'B', 'C', 'D')),
    position INTEGER NOT NULL,
    FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quiz_id TEXT NOT NULL,
    student_name TEXT NOT NULL,
    score INTEGER NOT NULL,
    total INTEGER NOT NULL,
    submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    submission_id INTEGER NOT NULL,
    question_id INTEGER NOT NULL,
    selected_option TEXT,
    is_correct INTEGER NOT NULL,
    FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
    FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
  );
`);

const listQuizzes = db.prepare(`
  SELECT q.*, COUNT(questions.id) AS question_count
  FROM quizzes q
  LEFT JOIN questions ON questions.quiz_id = q.id
  GROUP BY q.id
  ORDER BY q.created_at DESC
`);

const getQuiz = db.prepare('SELECT * FROM quizzes WHERE id = ?');
const getQuestionsForTeacher = db.prepare('SELECT * FROM questions WHERE quiz_id = ? ORDER BY position ASC');
const getQuestionsForStudent = db.prepare(`
  SELECT id, prompt, option_a, option_b, option_c, option_d, position
  FROM questions
  WHERE quiz_id = ?
  ORDER BY position ASC
`);
const getRecentSubmissions = db.prepare(`
  SELECT * FROM submissions
  WHERE quiz_id = ?
  ORDER BY submitted_at DESC
  LIMIT 20
`);

function makeQuizId() {
  return crypto.randomBytes(4).toString('hex');
}

function normalizeOption(value) {
  const option = String(value || '').trim().toUpperCase();
  return ['A', 'B', 'C', 'D'].includes(option) ? option : '';
}

function parseQuestions(body) {
  const prompts = Array.isArray(body.prompt) ? body.prompt : [body.prompt];
  const optionAs = Array.isArray(body.option_a) ? body.option_a : [body.option_a];
  const optionBs = Array.isArray(body.option_b) ? body.option_b : [body.option_b];
  const optionCs = Array.isArray(body.option_c) ? body.option_c : [body.option_c];
  const optionDs = Array.isArray(body.option_d) ? body.option_d : [body.option_d];
  const correctOptions = Array.isArray(body.correct_option) ? body.correct_option : [body.correct_option];

  return prompts.map((prompt, index) => ({
    prompt: String(prompt || '').trim(),
    option_a: String(optionAs[index] || '').trim(),
    option_b: String(optionBs[index] || '').trim(),
    option_c: String(optionCs[index] || '').trim(),
    option_d: String(optionDs[index] || '').trim(),
    correct_option: normalizeOption(correctOptions[index]),
    position: index + 1
  })).filter((question) => (
    question.prompt &&
    question.option_a &&
    question.option_b &&
    question.option_c &&
    question.option_d &&
    question.correct_option
  ));
}

app.get('/', (req, res) => {
  res.render('index', { quizzes: listQuizzes.all() });
});

app.get('/teacher/quizzes/new', (req, res) => {
  res.render('new-quiz', { error: null, values: {} });
});

app.post('/teacher/quizzes', (req, res) => {
  const title = String(req.body.title || '').trim();
  const description = String(req.body.description || '').trim();
  const questions = parseQuestions(req.body);

  if (!title || questions.length === 0) {
    return res.status(400).render('new-quiz', {
      error: 'Add a title and at least one complete question with a correct answer.',
      values: req.body
    });
  }

  const quizId = makeQuizId();
  const insertQuiz = db.prepare('INSERT INTO quizzes (id, title, description) VALUES (?, ?, ?)');
  const insertQuestion = db.prepare(`
    INSERT INTO questions
      (quiz_id, prompt, option_a, option_b, option_c, option_d, correct_option, position)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const createQuiz = db.transaction(() => {
    insertQuiz.run(quizId, title, description);
    for (const question of questions) {
      insertQuestion.run(
        quizId,
        question.prompt,
        question.option_a,
        question.option_b,
        question.option_c,
        question.option_d,
        question.correct_option,
        question.position
      );
    }
  });

  createQuiz();
  res.redirect(`/teacher/quizzes/${quizId}`);
});

app.get('/teacher/quizzes/:id', (req, res) => {
  const quiz = getQuiz.get(req.params.id);
  if (!quiz) return res.status(404).render('not-found');

  res.render('teacher-quiz', {
    quiz,
    questions: getQuestionsForTeacher.all(quiz.id),
    submissions: getRecentSubmissions.all(quiz.id)
  });
});

app.get('/quizzes/:id', (req, res) => {
  const quiz = getQuiz.get(req.params.id);
  if (!quiz) return res.status(404).render('not-found');

  res.render('take-quiz', {
    quiz,
    questions: getQuestionsForStudent.all(quiz.id),
    error: null
  });
});

app.post('/quizzes/:id/submissions', (req, res) => {
  const quiz = getQuiz.get(req.params.id);
  if (!quiz) return res.status(404).render('not-found');

  const studentName = String(req.body.student_name || '').trim();
  const questions = getQuestionsForTeacher.all(quiz.id);

  if (!studentName) {
    return res.status(400).render('take-quiz', {
      quiz,
      questions: getQuestionsForStudent.all(quiz.id),
      error: 'Enter your name before submitting.'
    });
  }

  let score = 0;
  const checkedAnswers = questions.map((question) => {
    const selected = normalizeOption(req.body[`answer_${question.id}`]);
    const isCorrect = selected === question.correct_option;
    if (isCorrect) score += 1;
    return { question, selected, isCorrect };
  });

  const insertSubmission = db.prepare(`
    INSERT INTO submissions (quiz_id, student_name, score, total)
    VALUES (?, ?, ?, ?)
  `);
  const insertAnswer = db.prepare(`
    INSERT INTO answers (submission_id, question_id, selected_option, is_correct)
    VALUES (?, ?, ?, ?)
  `);

  const saveSubmission = db.transaction(() => {
    const submission = insertSubmission.run(quiz.id, studentName, score, questions.length);
    for (const answer of checkedAnswers) {
      insertAnswer.run(
        submission.lastInsertRowid,
        answer.question.id,
        answer.selected || null,
        answer.isCorrect ? 1 : 0
      );
    }
    return submission.lastInsertRowid;
  });

  const submissionId = saveSubmission();
  res.redirect(`/submissions/${submissionId}`);
});

app.get('/submissions/:id', (req, res) => {
  const submission = db.prepare(`
    SELECT submissions.*, quizzes.title
    FROM submissions
    JOIN quizzes ON quizzes.id = submissions.quiz_id
    WHERE submissions.id = ?
  `).get(req.params.id);

  if (!submission) return res.status(404).render('not-found');

  const answers = db.prepare(`
    SELECT
      questions.prompt,
      questions.option_a,
      questions.option_b,
      questions.option_c,
      questions.option_d,
      questions.correct_option,
      answers.selected_option,
      answers.is_correct
    FROM answers
    JOIN questions ON questions.id = answers.question_id
    WHERE answers.submission_id = ?
    ORDER BY questions.position ASC
  `).all(submission.id);

  res.render('result', { submission, answers });
});

app.listen(PORT, () => {
  console.log(`Quiz platform running on http://localhost:${PORT}`);
});
