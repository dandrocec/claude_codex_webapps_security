'use strict';

const db = require('./db');

// --- Users ---------------------------------------------------------------
const createUser = db.prepare(
  'INSERT INTO users (username, password_hash) VALUES (?, ?)'
);
const findUserByName = db.prepare('SELECT * FROM users WHERE username = ?');
const findUserById = db.prepare('SELECT * FROM users WHERE id = ?');

// --- Questions -----------------------------------------------------------
const insertQuestion = db.prepare(
  'INSERT INTO questions (user_id, title, body) VALUES (?, ?, ?)'
);

// List questions with author name and net score, newest first.
const listQuestions = db.prepare(`
  SELECT q.*, u.username AS author,
         COALESCE((SELECT SUM(value) FROM votes
                   WHERE post_type = 'question' AND post_id = q.id), 0) AS score,
         (SELECT COUNT(*) FROM answers WHERE question_id = q.id) AS answer_count
  FROM questions q
  JOIN users u ON u.id = q.user_id
  ORDER BY q.created_at DESC
`);

const getQuestion = db.prepare(`
  SELECT q.*, u.username AS author,
         COALESCE((SELECT SUM(value) FROM votes
                   WHERE post_type = 'question' AND post_id = q.id), 0) AS score
  FROM questions q
  JOIN users u ON u.id = q.user_id
  WHERE q.id = ?
`);

const setAcceptedAnswer = db.prepare(
  'UPDATE questions SET accepted_answer_id = ? WHERE id = ?'
);

// --- Answers -------------------------------------------------------------
const insertAnswer = db.prepare(
  'INSERT INTO answers (question_id, user_id, body) VALUES (?, ?, ?)'
);

// Answers for a question, sorted by score (desc). Accepted answer floats to top.
const listAnswers = db.prepare(`
  SELECT a.*, u.username AS author,
         COALESCE((SELECT SUM(value) FROM votes
                   WHERE post_type = 'answer' AND post_id = a.id), 0) AS score
  FROM answers a
  JOIN users u ON u.id = a.user_id
  WHERE a.question_id = ?
  ORDER BY (a.id = (SELECT accepted_answer_id FROM questions WHERE id = ?)) DESC,
           score DESC,
           a.created_at ASC
`);

const getAnswer = db.prepare('SELECT * FROM answers WHERE id = ?');

// --- Votes ---------------------------------------------------------------
const getVote = db.prepare(
  'SELECT value FROM votes WHERE user_id = ? AND post_type = ? AND post_id = ?'
);
const deleteVote = db.prepare(
  'DELETE FROM votes WHERE user_id = ? AND post_type = ? AND post_id = ?'
);
const upsertVote = db.prepare(`
  INSERT INTO votes (user_id, post_type, post_id, value) VALUES (?, ?, ?, ?)
  ON CONFLICT (user_id, post_type, post_id) DO UPDATE SET value = excluded.value
`);

// Returns the user's votes on a set of posts as a map { post_id: value }.
function votesForUser(userId, postType, ids) {
  if (!userId || ids.length === 0) return {};
  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT post_id, value FROM votes
       WHERE user_id = ? AND post_type = ? AND post_id IN (${placeholders})`
    )
    .all(userId, postType, ...ids);
  return Object.fromEntries(rows.map((r) => [r.post_id, r.value]));
}

/**
 * Apply a vote. Casting the same value again removes the vote (toggle).
 * Enforces "one vote each" via the primary key + upsert.
 */
function castVote(userId, postType, postId, value) {
  const existing = getVote.get(userId, postType, postId);
  if (existing && existing.value === value) {
    deleteVote.run(userId, postType, postId); // toggle off
  } else {
    upsertVote.run(userId, postType, postId, value);
  }
}

module.exports = {
  createUser,
  findUserByName,
  findUserById,
  insertQuestion,
  listQuestions,
  getQuestion,
  setAcceptedAnswer,
  insertAnswer,
  listAnswers,
  getAnswer,
  votesForUser,
  castVote,
};
