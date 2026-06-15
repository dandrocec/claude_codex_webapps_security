'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');

const db = require('../db');

const router = express.Router();

// Limit public submissions to curb spam/flooding of a shared link.
const submitLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many submissions from this address. Please try again later.',
});

/** Look up a survey by its unguessable public token. */
function loadSurveyByToken(token) {
  if (typeof token !== 'string' || token.length === 0 || token.length > 100) {
    return null;
  }
  return db.prepare('SELECT * FROM surveys WHERE public_token = ?').get(token);
}

// --- Public fill-out page --------------------------------------------------
router.get('/s/:token', (req, res) => {
  const survey = loadSurveyByToken(req.params.token);
  if (!survey) {
    return res.status(404).render('error', {
      title: 'Survey unavailable',
      message: 'This survey link is invalid or no longer exists.',
    });
  }

  const questions = db
    .prepare('SELECT * FROM questions WHERE survey_id = ? ORDER BY position')
    .all(survey.id);

  res.render('public/fill', {
    title: survey.title,
    survey,
    questions,
    submitted: false,
  });
});

// --- Public submission -----------------------------------------------------
router.post('/s/:token', submitLimiter, (req, res) => {
  const survey = loadSurveyByToken(req.params.token);
  if (!survey) {
    return res.status(404).render('error', {
      title: 'Survey unavailable',
      message: 'This survey link is invalid or no longer exists.',
    });
  }

  const questions = db
    .prepare('SELECT * FROM questions WHERE survey_id = ? ORDER BY position')
    .all(survey.id);

  // Accept only answers for questions that actually belong to this survey,
  // and cap each answer's length. Inputs are stored raw and escaped on output.
  const insertResponseTx = db.transaction(() => {
    const resp = db
      .prepare('INSERT INTO responses (survey_id) VALUES (?)')
      .run(survey.id);

    const insertAnswer = db.prepare(
      'INSERT INTO answers (response_id, question_id, value) VALUES (?, ?, ?)'
    );

    for (const q of questions) {
      let value = req.body[`q_${q.id}`];
      if (value === undefined || value === null) value = '';
      value = String(value).slice(0, 2000).trim();
      insertAnswer.run(resp.lastInsertRowid, q.id, value);
    }
  });

  insertResponseTx();

  res.render('public/fill', {
    title: survey.title,
    survey,
    questions,
    submitted: true,
  });
});

module.exports = router;
