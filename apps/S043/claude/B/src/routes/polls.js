'use strict';

const express = require('express');
const { body, validationResult } = require('express-validator');

const db = require('../db');
const { requireAuth } = require('../middleware/security');

const router = express.Router();

const MAX_OPTIONS = 10;
const MIN_OPTIONS = 2;

// Prepared statements (parameterised — no string concatenation of user input).
const stmts = {
  listPolls: db.prepare(`
    SELECT p.id, p.question, p.created_at, u.username AS owner,
           (SELECT COUNT(*) FROM votes v WHERE v.poll_id = p.id) AS total_votes
    FROM polls p
    JOIN users u ON u.id = p.user_id
    ORDER BY p.created_at DESC
  `),
  getPoll: db.prepare(`
    SELECT p.id, p.question, p.created_at, p.user_id, u.username AS owner
    FROM polls p
    JOIN users u ON u.id = p.user_id
    WHERE p.id = ?
  `),
  getOptions: db.prepare(`
    SELECT o.id, o.label,
           (SELECT COUNT(*) FROM votes v WHERE v.option_id = o.id) AS votes
    FROM options o
    WHERE o.poll_id = ?
    ORDER BY o.id ASC
  `),
  insertPoll: db.prepare('INSERT INTO polls (user_id, question) VALUES (?, ?)'),
  insertOption: db.prepare('INSERT INTO options (poll_id, label) VALUES (?, ?)'),
  optionBelongsToPoll: db.prepare(
    'SELECT id FROM options WHERE id = ? AND poll_id = ?'
  ),
  hasVoted: db.prepare(
    'SELECT id FROM votes WHERE poll_id = ? AND voter_token = ?'
  ),
  insertVote: db.prepare(
    'INSERT INTO votes (poll_id, option_id, voter_token) VALUES (?, ?, ?)'
  ),
  deletePoll: db.prepare('DELETE FROM polls WHERE id = ? AND user_id = ?'),
};

// Parse and validate a numeric route id; returns null if invalid.
function parseId(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// --- List all polls -------------------------------------------------------

router.get('/', (req, res) => {
  const polls = stmts.listPolls.all();
  res.render('index', { polls });
});

// --- New poll form --------------------------------------------------------

router.get('/polls/new', requireAuth, (req, res) => {
  res.render('new-poll', { errors: [], values: { question: '', options: ['', ''] } });
});

// --- Create poll ----------------------------------------------------------

router.post(
  '/polls',
  requireAuth,
  body('question')
    .trim()
    .isLength({ min: 3, max: 280 })
    .withMessage('Question must be 3–280 characters.'),
  (req, res, next) => {
    // Normalise options into a clean array of non-empty, trimmed strings.
    let rawOptions = req.body.options;
    if (!Array.isArray(rawOptions)) {
      rawOptions = rawOptions == null ? [] : [rawOptions];
    }
    const options = rawOptions
      .map((o) => (typeof o === 'string' ? o.trim() : ''))
      .filter((o) => o.length > 0 && o.length <= 200)
      .slice(0, MAX_OPTIONS);

    const errors = [];
    const result = validationResult(req);
    if (!result.isEmpty()) errors.push(...result.array().map((e) => e.msg));
    if (options.length < MIN_OPTIONS) {
      errors.push(`Please provide at least ${MIN_OPTIONS} options.`);
    }

    if (errors.length) {
      return res.status(400).render('new-poll', {
        errors,
        values: { question: req.body.question || '', options: options.length ? options : ['', ''] },
      });
    }

    try {
      // Wrap poll + options in a transaction for atomicity.
      const createPoll = db.transaction((question, opts, userId) => {
        const info = stmts.insertPoll.run(userId, question);
        const pollId = info.lastInsertRowid;
        for (const label of opts) {
          stmts.insertOption.run(pollId, label);
        }
        return pollId;
      });

      const pollId = createPoll(req.body.question.trim(), options, req.session.userId);
      res.redirect(`/polls/${pollId}`);
    } catch (err) {
      next(err);
    }
  }
);

// --- View a single poll + results ----------------------------------------

router.get('/polls/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(404).render('404');

  const poll = stmts.getPoll.get(id);
  if (!poll) return res.status(404).render('404');

  const options = stmts.getOptions.all(id);
  const alreadyVoted = !!stmts.hasVoted.get(id, req.voterToken);
  const isOwner =
    req.session.userId && req.session.userId === poll.user_id;

  res.render('poll', { poll, options, alreadyVoted, isOwner });
});

// --- Cast a vote ----------------------------------------------------------

router.post('/polls/:id/vote', (req, res, next) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(404).render('404');

  const poll = stmts.getPoll.get(id);
  if (!poll) return res.status(404).render('404');

  const optionId = parseId(req.body.optionId);
  if (!optionId) {
    return res.status(400).render('poll', {
      poll,
      options: stmts.getOptions.all(id),
      alreadyVoted: false,
      isOwner: req.session.userId === poll.user_id,
      voteError: 'Please choose an option.',
    });
  }

  // IDOR guard: the chosen option must belong to THIS poll.
  if (!stmts.optionBelongsToPoll.get(optionId, id)) {
    return res.status(400).render('404');
  }

  try {
    // The UNIQUE(poll_id, voter_token) constraint is the source of truth for
    // "one vote per poll"; catch the violation rather than racing a check.
    stmts.insertVote.run(id, optionId, req.voterToken);
  } catch (err) {
    if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.redirect(`/polls/${id}`); // already voted — show results
    }
    return next(err);
  }

  res.redirect(`/polls/${id}`);
});

// --- Delete a poll (owner only) ------------------------------------------

router.post('/polls/:id/delete', requireAuth, (req, res, next) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(404).render('404');

  try {
    // Access control enforced in the WHERE clause: only the owner's row matches.
    const info = stmts.deletePoll.run(id, req.session.userId);
    if (info.changes === 0) {
      return res.status(403).render('error', {
        status: 403,
        message: 'You can only delete your own polls.',
      });
    }
    res.redirect('/');
  } catch (err) {
    next(err);
  }
});

// --- JSON results endpoint (for live chart refresh) ----------------------

router.get('/polls/:id/results.json', (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Not found' });

  const poll = stmts.getPoll.get(id);
  if (!poll) return res.status(404).json({ error: 'Not found' });

  const options = stmts.getOptions.all(id);
  res.json({
    question: poll.question,
    options: options.map((o) => ({ id: o.id, label: o.label, votes: o.votes })),
  });
});

module.exports = router;
