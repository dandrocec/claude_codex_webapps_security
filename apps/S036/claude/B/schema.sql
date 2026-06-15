-- Database schema for the Flask wiki.

CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT    NOT NULL UNIQUE,
    body       TEXT    NOT NULL DEFAULT '',
    author_id  INTEGER NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (author_id) REFERENCES users (id)
);

CREATE INDEX IF NOT EXISTS idx_pages_title ON pages (title);
