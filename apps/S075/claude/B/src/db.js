'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dbFile = process.env.DATABASE_FILE || path.join(__dirname, '..', 'data', 'quiz.db');

// Ensure the directory for the database file exists.
fs.mkdirSync(path.dirname(dbFile), { recursive: true });

const db = new Database(dbFile);

// Pragmas: enforce foreign keys and use WAL for better concurrency.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * Create the schema if it does not already exist.
 * All access goes through prepared statements elsewhere, so user input
 * is never concatenated into SQL.
 */
function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL CHECK (role IN ('teacher', 'student')),
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS quizzes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id  INTEGER NOT NULL,
      title       TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      published   INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS questions (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      quiz_id  INTEGER NOT NULL,
      text     TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS options (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      question_id INTEGER NOT NULL,
      text        TEXT NOT NULL,
      is_correct  INTEGER NOT NULL DEFAULT 0,
      position    INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS attempts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      quiz_id    INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      score      INTEGER NOT NULL,
      total      INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE,
      FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS attempt_answers (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      attempt_id         INTEGER NOT NULL,
      question_id        INTEGER NOT NULL,
      selected_option_id INTEGER,
      FOREIGN KEY (attempt_id) REFERENCES attempts(id) ON DELETE CASCADE,
      FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
      FOREIGN KEY (selected_option_id) REFERENCES options(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_quizzes_teacher ON quizzes(teacher_id);
    CREATE INDEX IF NOT EXISTS idx_questions_quiz ON questions(quiz_id);
    CREATE INDEX IF NOT EXISTS idx_options_question ON options(question_id);
    CREATE INDEX IF NOT EXISTS idx_attempts_student ON attempts(student_id);
  `);
}

module.exports = { db, init };
