-- Database schema for the event-listing application.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT    NOT NULL,
    event_date   TEXT    NOT NULL,            -- ISO 8601 date (YYYY-MM-DD)
    location     TEXT    NOT NULL,
    description  TEXT    NOT NULL,
    organiser_id INTEGER NOT NULL,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (organiser_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_events_date      ON events (event_date);
CREATE INDEX IF NOT EXISTS idx_events_organiser ON events (organiser_id);
