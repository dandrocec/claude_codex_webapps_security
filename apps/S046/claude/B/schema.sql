-- Database schema (SQLite). Run via: composer init-db  (or php bin/init-db.php)

CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    is_admin      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS quotes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    text       TEXT    NOT NULL,
    author     TEXT    NOT NULL,
    approved   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL,
    updated_at TEXT    NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_quotes_approved ON quotes(approved);
CREATE INDEX IF NOT EXISTS idx_quotes_author   ON quotes(author);
CREATE INDEX IF NOT EXISTS idx_quotes_user      ON quotes(user_id);
