-- Database schema for the Flask blog.
-- Roles are constrained to the three supported values.
-- Post status follows the editorial workflow: draft -> submitted -> approved/rejected.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,
    email         TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL CHECK (role IN ('reader', 'author', 'editor')),
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS posts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT    NOT NULL,
    body         TEXT    NOT NULL,
    author_id    INTEGER NOT NULL,
    status       TEXT    NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
    review_note  TEXT,
    reviewer_id  INTEGER,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (author_id)   REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (reviewer_id) REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_posts_status    ON posts (status);
CREATE INDEX IF NOT EXISTS idx_posts_author_id ON posts (author_id);
