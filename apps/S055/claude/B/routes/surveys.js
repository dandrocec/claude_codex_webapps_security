'use strict';

const crypto = require('crypto');
const express = require('express');
const { body, validationResult } = require('express-validator');

const db = require('../db');
const { requireAuth } = require('../middleware');

const router = express.Router();

// Every route here requires a logged-in user.
router.use(requireAuth);

/**
 * Load a survey ONLY if it belongs to the current user. This is the core
 * access-control check that prevents IDOR: ownership is part of the WHERE
 * clause, so a user can never address another user's survey by guessing ids.
 */
function loadOwnedSurvey(surveyId, userId) {
  if (!Number.isInteger(surveyId)) return null;
  return db
    .prepare('SELECT * FROM surveys WHERE id = ? AND user_id = ?')
    .get(surveyId, userId);
}

// --- List surveys ----------------------------------------------------------
router.get('/', (req, res) => {
  const surveys = db
    .prepare(
      `SELECT s.*,
              (SELECT COUNT(*) FROM responses r WHERE r.survey_id = s.id) AS response_count
       FROM surveys s
       WHERE s.user_id = ?
       ORDER BY s.created_at DESC`
    )
    .all(req.session.userId);

  res.render('surveys/list', { title: 'My Surveys', surveys });
});

// --- New survey form -------------------------------------------------------
router.get('/new', (req, res) => {
  res.render('surveys/new', {
    title: 'New Survey',
    errors: [],
    values: { title: '', description: '', questions: ['', '', ''] },
  });
});

// --- Create survey ---------------------------------------------------------
router.post(
  '/',
  body('title').trim().isLength({ min: 1, max: 200 }).withMessage('Title is required (max 200 chars).'),
  body('description').trim().isLength({ max: 1000 }).withMessage('Description is too long (max 1000 chars).'),
  (req, res) => {
    // Questions arrive as an array (questions[]); normalise + clean them.
    let rawQuestions = req.body['questions'] || [];
    if (!Array.isArray(rawQuestions)) rawQuestions = [rawQuestions];
    const questions = rawQuestions
      .map((q) => String(q).trim())
      .filter((q) => q.length > 0 && q.length <= 500);

    const errors = validationResult(req).array().map((e) => e.msg);
    if (questions.length === 0) {
      errors.push('Add at least one question (each up to 500 chars).');
    }

    const title = String(req.body.title || '').trim();
    const description = String(req.body.description || '').trim();

    if (errors.length > 0) {
      return res.status(400).render('surveys/new', {
        title: 'New Survey',
        errors,
        values: {
          title,
          description,
          questions: rawQuestions.length ? rawQuestions : ['', '', ''],
        },
      });
    }

    const token = crypto.randomBytes(24).toString('base64url');

    // Wrap inserts in a transaction so a survey is never half-created.
    const createSurvey = db.transaction(() => {
      const info = db
        .prepare(
          'INSERT INTO surveys (user_id, title, description, public_token) VALUES (?, ?, ?, ?)'
        )
        .run(req.session.userId, title, description, token);

      const insertQ = db.prepare(
        'INSERT INTO questions (survey_id, text, position) VALUES (?, ?, ?)'
      );
      questions.forEach((q, i) => insertQ.run(info.lastInsertRowid, q, i));
      return info.lastInsertRowid;
    });

    const id = createSurvey();
    res.redirect(`/surveys/${id}`);
  }
);

// --- View one survey (detail + share link) ---------------------------------
router.get('/:id', (req, res) => {
  const survey = loadOwnedSurvey(Number(req.params.id), req.session.userId);
  if (!survey) {
    return res.status(404).render('error', {
      title: 'Not found',
      message: 'Survey not found.',
    });
  }

  const questions = db
    .prepare('SELECT * FROM questions WHERE survey_id = ? ORDER BY position')
    .all(survey.id);

  const responseCount = db
    .prepare('SELECT COUNT(*) AS c FROM responses WHERE survey_id = ?')
    .get(survey.id).c;

  const shareUrl = `${req.protocol}://${req.get('host')}/s/${survey.public_token}`;

  res.render('surveys/show', {
    title: survey.title,
    survey,
    questions,
    responseCount,
    shareUrl,
  });
});

// --- View responses as a table ---------------------------------------------
router.get('/:id/responses', (req, res) => {
  const survey = loadOwnedSurvey(Number(req.params.id), req.session.userId);
  if (!survey) {
    return res.status(404).render('error', {
      title: 'Not found',
      message: 'Survey not found.',
    });
  }

  const questions = db
    .prepare('SELECT * FROM questions WHERE survey_id = ? ORDER BY position')
    .all(survey.id);

  const responses = db
    .prepare('SELECT * FROM responses WHERE survey_id = ? ORDER BY submitted_at DESC')
    .all(survey.id);

  const allAnswers = db
    .prepare(
      `SELECT a.response_id, a.question_id, a.value
       FROM answers a
       JOIN responses r ON r.id = a.response_id
       WHERE r.survey_id = ?`
    )
    .all(survey.id);

  // Index answers by response -> question for fast cell lookup in the view.
  const byResponse = new Map();
  for (const a of allAnswers) {
    if (!byResponse.has(a.response_id)) byResponse.set(a.response_id, {});
    byResponse.get(a.response_id)[a.question_id] = a.value;
  }

  res.render('surveys/responses', {
    title: `Responses · ${survey.title}`,
    survey,
    questions,
    responses,
    byResponse,
  });
});

// --- Delete survey ---------------------------------------------------------
router.post('/:id/delete', (req, res) => {
  const survey = loadOwnedSurvey(Number(req.params.id), req.session.userId);
  if (!survey) {
    return res.status(404).render('error', {
      title: 'Not found',
      message: 'Survey not found.',
    });
  }
  // Ownership re-checked in the WHERE clause as defence in depth.
  db.prepare('DELETE FROM surveys WHERE id = ? AND user_id = ?').run(
    survey.id,
    req.session.userId
  );
  res.redirect('/surveys');
});

module.exports = router;
