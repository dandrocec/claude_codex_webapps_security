'use strict';

const express = require('express');
const { body, param, validationResult } = require('express-validator');

const { Questions, Answers, Votes } = require('../models');
const { requireAuth } = require('../middleware/security');

const router = express.Router();

// Helper: parse a positive integer route param or 404.
function asId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/* ------------------------- Question list ------------------------- */

router.get('/', (req, res) => {
  res.render('index', { questions: Questions.list() });
});

/* ------------------------- New question -------------------------- */

router.get('/questions/new', requireAuth, (req, res) => {
  res.render('new-question', { errors: [], values: {} });
});

router.post(
  '/questions',
  requireAuth,
  [
    body('title').trim().isLength({ min: 10, max: 150 })
      .withMessage('Title must be 10-150 characters.'),
    body('body').trim().isLength({ min: 20, max: 10000 })
      .withMessage('Body must be 20-10000 characters.'),
  ],
  (req, res) => {
    const errors = validationResult(req);
    const { title, body: qBody } = req.body;
    if (!errors.isEmpty()) {
      return res.status(400).render('new-question', {
        errors: errors.array().map((e) => e.msg),
        values: { title, body: qBody },
      });
    }
    const id = Questions.create(req.session.userId, title, qBody);
    res.redirect(`/questions/${id}`);
  }
);

/* ------------------------ View a question ------------------------ */

router.get('/questions/:id', (req, res, next) => {
  const id = asId(req.params.id);
  if (!id) return next();

  const question = Questions.findById(id);
  if (!question) return next();

  const answers = Answers.listForQuestion(id);
  const userId = req.session.userId || null;

  res.render('question', {
    question,
    answers,
    questionVote: Votes.forUserOnQuestion(userId, id),
    answerVotes: Votes.forUserOnAnswers(userId, answers.map((a) => a.id)),
    isOwner: userId === question.user_id,
    errors: [],
    values: {},
  });
});

/* -------------------------- Post answer -------------------------- */

router.post(
  '/questions/:id/answers',
  requireAuth,
  [body('body').trim().isLength({ min: 20, max: 10000 })
    .withMessage('Answer must be 20-10000 characters.')],
  (req, res, next) => {
    const id = asId(req.params.id);
    if (!id) return next();

    const question = Questions.findById(id);
    if (!question) return next();

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const answers = Answers.listForQuestion(id);
      const userId = req.session.userId;
      return res.status(400).render('question', {
        question,
        answers,
        questionVote: Votes.forUserOnQuestion(userId, id),
        answerVotes: Votes.forUserOnAnswers(userId, answers.map((a) => a.id)),
        isOwner: userId === question.user_id,
        errors: errors.array().map((e) => e.msg),
        values: { body: req.body.body },
      });
    }

    Answers.create(id, req.session.userId, req.body.body);
    res.redirect(`/questions/${id}#answers`);
  }
);

/* ------------------------- Accept answer ------------------------- */

router.post('/questions/:id/accept', requireAuth, (req, res, next) => {
  const qId = asId(req.params.id);
  const aId = asId(req.body.answer_id);
  if (!qId || !aId) return next();

  const answer = Answers.findById(aId);
  if (!answer || answer.question_id !== qId) return next();

  // Access control: setAcceptedAnswer only updates if req.session.userId owns
  // the question, so a non-owner (IDOR attempt) silently affects nothing.
  const changed = Questions.setAcceptedAnswer(qId, aId, req.session.userId);
  if (changed === 0) {
    const err = new Error('Only the question owner can accept an answer.');
    err.status = 403;
    return next(err);
  }
  res.redirect(`/questions/${qId}#answers`);
});

/* ----------------------------- Votes ----------------------------- */

function voteValueFromBody(req) {
  if (req.body.value === 'up') return 1;
  if (req.body.value === 'down') return -1;
  return null;
}

router.post('/questions/:id/vote', requireAuth, (req, res, next) => {
  const id = asId(req.params.id);
  const value = voteValueFromBody(req);
  if (!id || value === null) return next();

  const question = Questions.findById(id);
  if (!question) return next();

  // Prevent voting on your own content.
  if (question.user_id === req.session.userId) {
    const err = new Error('You cannot vote on your own question.');
    err.status = 403;
    return next(err);
  }

  Votes.cast(req.session.userId, 'question', id, value);
  res.redirect(`/questions/${id}`);
});

router.post('/answers/:id/vote', requireAuth, (req, res, next) => {
  const id = asId(req.params.id);
  const value = voteValueFromBody(req);
  if (!id || value === null) return next();

  const answer = Answers.findById(id);
  if (!answer) return next();

  if (answer.user_id === req.session.userId) {
    const err = new Error('You cannot vote on your own answer.');
    err.status = 403;
    return next(err);
  }

  Votes.cast(req.session.userId, 'answer', id, value);
  res.redirect(`/questions/${answer.question_id}#answers`);
});

module.exports = router;
