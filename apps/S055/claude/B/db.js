'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'survey.db');

// Ensure the directory for the database exists.
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

const db = new Database(DB_FILE);

// Pragmas for integrity + concurrency.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Schema. Created once; CREATE IF NOT EXISTS is idempotent.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS surveys (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL,
    title        TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    public_token TEXT NOT NULL UNIQUE,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS questions (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    survey_id INTEGER NOT NULL,
    text      TEXT NOT NULL,
    position  INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (survey_id) REFERENCES surveys(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS responses (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    survey_id    INTEGER NOT NULL,
    submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (survey_id) REFERENCES surveys(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS answers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    response_id INTEGER NOT NULL,
    question_id INTEGER NOT NULL,
    value       TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (response_id) REFERENCES responses(id) ON DELETE CASCADE,
    FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_surveys_user ON surveys(user_id);
  CREATE INDEX IF NOT EXISTS idx_questions_survey ON questions(survey_id);
  CREATE INDEX IF NOT EXISTS idx_responses_survey ON responses(survey_id);
  CREATE INDEX IF NOT EXISTS idx_answers_response ON answers(response_id);
`);

module.exports = db;
