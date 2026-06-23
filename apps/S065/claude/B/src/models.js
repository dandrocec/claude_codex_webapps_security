'use strict';

const db = require('./db');

/* ----------------------------- Users ----------------------------- */

const insertUser = db.prepare(
  'INSERT INTO users (username, password_hash) VALUES (?, ?)'
);
const selectUserByUsername = db.prepare(
  'SELECT * FROM users WHERE username = ?'
);
const selectUserById = db.prepare('SELECT * FROM users WHERE id = ?');

const Users = {
  create(username, passwordHash) {
    const info = insertUser.run(username, passwordHash);
    return info.lastInsertRowid;
  },
  findByUsername(username) {
    return selectUserByUsername.get(username);
  },
  findById(id) {
    return selectUserById.get(id);
  },
};

/* --------------------------- Questions --------------------------- */

const insertQuestion = db.prepare(
  'INSERT INTO questions (user_id, title, body) VALUES (?, ?, ?)'
);

// List with author name and computed score, newest first.
const selectQuestionList = db.prepare(`
  SELECT q.id, q.title, q.created_at,
         u.username AS author,
         COALESCE((SELECT SUM(value) FROM votes
                   WHERE target_type = 'question' AND target_id = q.id), 0) AS score,
         (SELECT COUNT(*) FROM answers a WHERE a.question_id = q.id) AS answer_count,
         (q.accepted_answer_id IS NOT NULL) AS has_accepted
  FROM questions q
  JOIN users u ON u.id = q.user_id
  ORDER BY q.created_at DESC
  LIMIT 100
`);

const selectQuestionById = db.prepare(`
  SELECT q.*, u.username AS author,
         COALESCE((SELECT SUM(value) FROM votes
                   WHERE target_type = 'question' AND target_id = q.id), 0) AS score
  FROM questions q
  JOIN users u ON u.id = q.user_id
  WHERE q.id = ?
`);

const setAcceptedAnswer = db.prepare(
  'UPDATE questions SET accepted_answer_id = ? WHERE id = ? AND user_id = ?'
);

const Questions = {
  create(userId, title, body) {
    return insertQuestion.run(userId, title, body).lastInsertRowid;
  },
  list() {
    return selectQuestionList.all();
  },
  findById(id) {
    return selectQuestionById.get(id);
  },
  // Returns number of rows changed (1 if the caller owns the question).
  setAcceptedAnswer(questionId, answerId, ownerId) {
    return setAcceptedAnswer.run(answerId, questionId, ownerId).changes;
  },
};

/* ---------------------------- Answers ---------------------------- */

const insertAnswer = db.prepare(
  'INSERT INTO answers (question_id, user_id, body) VALUES (?, ?, ?)'
);

// Answers for a question, with author + score, accepted ones first, then by score.
const selectAnswersForQuestion = db.prepare(`
  SELECT a.*, u.username AS author,
         COALESCE((SELECT SUM(value) FROM votes
                   WHERE target_type = 'answer' AND target_id = a.id), 0) AS score,
         (a.id = (SELECT accepted_answer_id FROM questions WHERE id = a.question_id)) AS is_accepted
  FROM answers a
  JOIN users u ON u.id = a.user_id
  WHERE a.question_id = ?
  ORDER BY is_accepted DESC, score DESC, a.created_at ASC
`);

const selectAnswerById = db.prepare('SELECT * FROM answers WHERE id = ?');

const Answers = {
  create(questionId, userId, body) {
    return insertAnswer.run(questionId, userId, body).lastInsertRowid;
  },
  listForQuestion(questionId) {
    return selectAnswersForQuestion.all(questionId);
  },
  findById(id) {
    return selectAnswerById.get(id);
  },
};

/* ----------------------------- Votes ----------------------------- */

const selectVote = db.prepare(
  'SELECT * FROM votes WHERE user_id = ? AND target_type = ? AND target_id = ?'
);
const insertVote = db.prepare(
  'INSERT INTO votes (user_id, target_type, target_id, value) VALUES (?, ?, ?, ?)'
);
const updateVote = db.prepare(
  'UPDATE votes SET value = ? WHERE user_id = ? AND target_type = ? AND target_id = ?'
);
const deleteVote = db.prepare(
  'DELETE FROM votes WHERE user_id = ? AND target_type = ? AND target_id = ?'
);

const Votes = {
  // Casts/changes a vote. Re-casting the same direction removes the vote (toggle).
  cast(userId, targetType, targetId, value) {
    const existing = selectVote.get(userId, targetType, targetId);
    if (!existing) {
      insertVote.run(userId, targetType, targetId, value);
    } else if (existing.value === value) {
      deleteVote.run(userId, targetType, targetId);
    } else {
      updateVote.run(value, userId, targetType, targetId);
    }
  },
  // Map of the current user's votes for a set of answer ids, used to render UI state.
  forUserOnAnswers(userId, answerIds) {
    const map = {};
    if (!userId || answerIds.length === 0) return map;
    for (const id of answerIds) {
      const v = selectVote.get(userId, 'answer', id);
      if (v) map[id] = v.value;
    }
    return map;
  },
  forUserOnQuestion(userId, questionId) {
    if (!userId) return 0;
    const v = selectVote.get(userId, 'question', questionId);
    return v ? v.value : 0;
  },
};

module.exports = { Users, Questions, Answers, Votes };
