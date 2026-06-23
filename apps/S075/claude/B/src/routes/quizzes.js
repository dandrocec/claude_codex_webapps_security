'use strict';

const express = require('express');
const { body, validationResult } = require('express-validator');
const { db } = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');

const router = express.Router();

// --- Prepared statements (parameterised; no string concatenation) -----------

const stmt = {
  insertQuiz: db.prepare(
    'INSERT INTO quizzes (teacher_id, title, description, published) VALUES (?, ?, ?, ?)'
  ),
  insertQuestion: db.prepare(
    'INSERT INTO questions (quiz_id, text, position) VALUES (?, ?, ?)'
  ),
  insertOption: db.prepare(
    'INSERT INTO options (question_id, text, is_correct, position) VALUES (?, ?, ?, ?)'
  ),
  quizById: db.prepare('SELECT * FROM quizzes WHERE id = ?'),
  quizzesByTeacher: db.prepare(
    'SELECT * FROM quizzes WHERE teacher_id = ? ORDER BY created_at DESC'
  ),
  publishedQuizzes: db.prepare(`
    SELECT q.*, u.username AS teacher_name
    FROM quizzes q JOIN users u ON u.id = q.teacher_id
    WHERE q.published = 1
    ORDER BY q.created_at DESC
  `),
  questionsByQuiz: db.prepare(
    'SELECT * FROM questions WHERE quiz_id = ? ORDER BY position, id'
  ),
  optionsByQuestion: db.prepare(
    'SELECT * FROM options WHERE question_id = ? ORDER BY position, id'
  ),
  setPublished: db.prepare('UPDATE quizzes SET published = ? WHERE id = ? AND teacher_id = ?'),
  deleteQuiz: db.prepare('DELETE FROM quizzes WHERE id = ? AND teacher_id = ?'),
  insertAttempt: db.prepare(
    'INSERT INTO attempts (quiz_id, student_id, score, total) VALUES (?, ?, ?, ?)'
  ),
  insertAttemptAnswer: db.prepare(
    'INSERT INTO attempt_answers (attempt_id, question_id, selected_option_id) VALUES (?, ?, ?)'
  ),
  attemptById: db.prepare('SELECT * FROM attempts WHERE id = ?'),
  attemptsByStudentAndQuiz: db.prepare(
    'SELECT * FROM attempts WHERE student_id = ? AND quiz_id = ? ORDER BY created_at DESC'
  ),
  attemptsByQuiz: db.prepare(`
    SELECT a.*, u.username AS student_name
    FROM attempts a JOIN users u ON u.id = a.student_id
    WHERE a.quiz_id = ? ORDER BY a.created_at DESC
  `),
};

// --- Helpers ----------------------------------------------------------------

function loadOwnedQuiz(quizId, teacherId) {
  const quiz = stmt.quizById.get(quizId);
  if (!quiz || quiz.teacher_id !== teacherId) return null; // prevents IDOR
  return quiz;
}

function parseId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// ============================================================================
// Dashboard
// ============================================================================

router.get('/', requireLogin, (req, res) => {
  if (req.session.user.role === 'teacher') {
    const quizzes = stmt.quizzesByTeacher.all(req.session.user.id);
    return res.render('teacher/dashboard', { title: 'My Quizzes', quizzes });
  }
  const quizzes = stmt.publishedQuizzes.all();
  res.render('student/dashboard', { title: 'Available Quizzes', quizzes });
});

// ============================================================================
// Teacher: create quiz
// ============================================================================

router.get('/quizzes/new', requireRole('teacher'), (req, res) => {
  res.render('teacher/new', { title: 'New Quiz', errors: [], values: {} });
});

router.post(
  '/quizzes',
  requireRole('teacher'),
  [
    body('title').trim().isLength({ min: 1, max: 200 }).withMessage('Title is required (max 200 chars).'),
    body('description').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }),
  ],
  (req, res, next) => {
    try {
      const errors = validationResult(req).array();
      const { title, description } = req.body;

      // Normalise the dynamic questions structure into a clean array.
      const rawQuestions = Array.isArray(req.body.questions) ? req.body.questions : [];
      const questions = [];

      rawQuestions.forEach((q) => {
        if (!q || typeof q !== 'object') return;
        const text = typeof q.text === 'string' ? q.text.trim() : '';
        const options = (Array.isArray(q.options) ? q.options : [])
          .map((o) => (typeof o === 'string' ? o.trim() : ''))
          .filter((o) => o.length > 0 && o.length <= 500);
        const correct = parseInt(q.correct, 10);

        if (!text) return;
        if (options.length < 2) {
          errors.push({ msg: `Question "${text.slice(0, 40)}" needs at least 2 options.` });
          return;
        }
        if (!Number.isInteger(correct) || correct < 0 || correct >= options.length) {
          errors.push({ msg: `Question "${text.slice(0, 40)}" needs a valid correct answer selected.` });
          return;
        }
        questions.push({ text: text.slice(0, 1000), options, correct });
      });

      if (questions.length === 0) {
        errors.push({ msg: 'Add at least one complete question.' });
      }

      if (errors.length > 0) {
        return res.status(400).render('teacher/new', {
          title: 'New Quiz',
          errors,
          values: { title, description },
        });
      }

      const publish = req.body.publish === 'on' ? 1 : 0;

      // Insert quiz, questions, and options atomically.
      const createQuiz = db.transaction(() => {
        const quizInfo = stmt.insertQuiz.run(
          req.session.user.id,
          title.trim(),
          (description || '').trim(),
          publish
        );
        const quizId = quizInfo.lastInsertRowid;

        questions.forEach((q, qi) => {
          const qInfo = stmt.insertQuestion.run(quizId, q.text, qi);
          const questionId = qInfo.lastInsertRowid;
          q.options.forEach((optText, oi) => {
            stmt.insertOption.run(questionId, optText, oi === q.correct ? 1 : 0, oi);
          });
        });

        return quizId;
      });

      const quizId = createQuiz();
      res.redirect(`/quizzes/${quizId}/manage`);
    } catch (err) {
      next(err);
    }
  }
);

// ============================================================================
// Teacher: manage / view results (owner only)
// ============================================================================

router.get('/quizzes/:id/manage', requireRole('teacher'), (req, res) => {
  const quizId = parseId(req.params.id);
  if (!quizId) return res.status(404).render('error', notFound());

  const quiz = loadOwnedQuiz(quizId, req.session.user.id);
  if (!quiz) return res.status(404).render('error', notFound());

  const questions = stmt.questionsByQuiz.all(quizId).map((q) => ({
    ...q,
    options: stmt.optionsByQuestion.all(q.id),
  }));
  const attempts = stmt.attemptsByQuiz.all(quizId);

  res.render('teacher/manage', { title: quiz.title, quiz, questions, attempts });
});

router.post('/quizzes/:id/publish', requireRole('teacher'), (req, res) => {
  const quizId = parseId(req.params.id);
  if (!quizId) return res.status(404).render('error', notFound());

  const quiz = loadOwnedQuiz(quizId, req.session.user.id);
  if (!quiz) return res.status(404).render('error', notFound());

  const next = quiz.published ? 0 : 1;
  stmt.setPublished.run(next, quizId, req.session.user.id);
  res.redirect(`/quizzes/${quizId}/manage`);
});

router.post('/quizzes/:id/delete', requireRole('teacher'), (req, res) => {
  const quizId = parseId(req.params.id);
  if (!quizId) return res.status(404).render('error', notFound());

  const quiz = loadOwnedQuiz(quizId, req.session.user.id);
  if (!quiz) return res.status(404).render('error', notFound());

  stmt.deleteQuiz.run(quizId, req.session.user.id);
  res.redirect('/');
});

// ============================================================================
// Student: take quiz
// ============================================================================

router.get('/quizzes/:id/take', requireRole('student'), (req, res) => {
  const quizId = parseId(req.params.id);
  if (!quizId) return res.status(404).render('error', notFound());

  const quiz = stmt.quizById.get(quizId);
  if (!quiz || !quiz.published) return res.status(404).render('error', notFound());

  // IMPORTANT: select only fields safe to expose. is_correct is NEVER sent.
  const questions = stmt.questionsByQuiz.all(quizId).map((q) => ({
    id: q.id,
    text: q.text,
    options: stmt
      .optionsByQuestion.all(q.id)
      .map((o) => ({ id: o.id, text: o.text })),
  }));

  const previous = stmt.attemptsByStudentAndQuiz.all(req.session.user.id, quizId);
  res.render('student/take', { title: quiz.title, quiz, questions, previous });
});

router.post('/quizzes/:id/submit', requireRole('student'), (req, res, next) => {
  try {
    const quizId = parseId(req.params.id);
    if (!quizId) return res.status(404).render('error', notFound());

    const quiz = stmt.quizById.get(quizId);
    if (!quiz || !quiz.published) return res.status(404).render('error', notFound());

    const questions = stmt.questionsByQuiz.all(quizId);
    const submitted = req.body.answers && typeof req.body.answers === 'object'
      ? req.body.answers
      : {};

    let score = 0;
    const graded = [];

    for (const q of questions) {
      const options = stmt.optionsByQuestion.all(q.id);
      const correctOption = options.find((o) => o.is_correct === 1);
      const selectedId = parseId(submitted[q.id]);

      // Only accept an option that genuinely belongs to this question (IDOR-safe).
      const selectedOption = options.find((o) => o.id === selectedId) || null;
      const isCorrect = selectedOption && correctOption && selectedOption.id === correctOption.id;
      if (isCorrect) score += 1;

      graded.push({
        question: q,
        options,
        selectedId: selectedOption ? selectedOption.id : null,
        correctId: correctOption ? correctOption.id : null,
        isCorrect: !!isCorrect,
      });
    }

    const total = questions.length;

    const persist = db.transaction(() => {
      const info = stmt.insertAttempt.run(quizId, req.session.user.id, score, total);
      const attemptId = info.lastInsertRowid;
      graded.forEach((g) => {
        stmt.insertAttemptAnswer.run(attemptId, g.question.id, g.selectedId);
      });
      return attemptId;
    });

    const attemptId = persist();

    res.render('student/result', {
      title: 'Your Result',
      quiz,
      score,
      total,
      graded,
      attemptId,
    });
  } catch (err) {
    next(err);
  }
});

function notFound() {
  return { title: 'Not found', message: 'The requested resource was not found.', status: 404 };
}

module.exports = router;
