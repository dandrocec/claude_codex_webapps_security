'use strict';

// Optional helper that creates demo accounts and a sample quiz.
// Run with:  npm run seed
require('dotenv').config();

const bcrypt = require('bcrypt');
const { db, init } = require('./db');

init();

const getUser = db.prepare('SELECT id FROM users WHERE username = ?');
const insertUser = db.prepare(
  'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)'
);

async function ensureUser(username, password, role) {
  const existing = getUser.get(username);
  if (existing) return existing.id;
  const hash = await bcrypt.hash(password, 12);
  return insertUser.run(username, hash, role).lastInsertRowid;
}

(async () => {
  const teacherId = await ensureUser('teacher', 'password123', 'teacher');
  await ensureUser('student', 'password123', 'student');

  const already = db.prepare('SELECT id FROM quizzes WHERE teacher_id = ? AND title = ?')
    .get(teacherId, 'General Knowledge');

  if (!already) {
    const seedQuiz = db.transaction(() => {
      const quizId = db
        .prepare('INSERT INTO quizzes (teacher_id, title, description, published) VALUES (?, ?, ?, 1)')
        .run(teacherId, 'General Knowledge', 'A short sample quiz.').lastInsertRowid;

      const data = [
        { q: 'What is the capital of France?', opts: ['Paris', 'Rome', 'Berlin', 'Madrid'], correct: 0 },
        { q: 'What is 6 × 7?', opts: ['42', '36', '48', '40'], correct: 0 },
        { q: 'Which planet is the "Red Planet"?', opts: ['Venus', 'Mars', 'Jupiter', 'Saturn'], correct: 1 },
      ];

      const insertQ = db.prepare('INSERT INTO questions (quiz_id, text, position) VALUES (?, ?, ?)');
      const insertO = db.prepare(
        'INSERT INTO options (question_id, text, is_correct, position) VALUES (?, ?, ?, ?)'
      );

      data.forEach((item, qi) => {
        const qId = insertQ.run(quizId, item.q, qi).lastInsertRowid;
        item.opts.forEach((opt, oi) => insertO.run(qId, opt, oi === item.correct ? 1 : 0, oi));
      });
    });
    seedQuiz();
  }

  console.log('Seed complete.');
  console.log('  teacher / password123');
  console.log('  student / password123');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
