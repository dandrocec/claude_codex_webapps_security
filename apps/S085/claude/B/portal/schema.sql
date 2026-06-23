-- Database schema for the recruitment portal.
-- All access is performed via parameterised queries in the application code.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL CHECK (role IN ('candidate', 'recruiter')),
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS profiles (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL UNIQUE,
    full_name       TEXT    NOT NULL,
    headline        TEXT    NOT NULL DEFAULT '',
    location        TEXT    NOT NULL DEFAULT '',
    bio             TEXT    NOT NULL DEFAULT '',
    -- Comma-separated, normalised list of skills (lower-cased) used for search.
    skills          TEXT    NOT NULL DEFAULT '',
    resume_filename TEXT,            -- server-generated random name on disk
    resume_original TEXT,            -- original name, shown to users only (never used as a path)
    updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_profiles_skills ON profiles (skills);
