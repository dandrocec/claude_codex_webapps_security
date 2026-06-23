-- Database schema for the recruiting application.
-- All access goes through parameterised queries in the application layer.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL CHECK (role IN ('employer', 'applicant')),
    full_name     TEXT    NOT NULL,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS jobs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    employer_id INTEGER NOT NULL,
    title       TEXT    NOT NULL,
    location    TEXT    NOT NULL,
    description TEXT    NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (employer_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS applications (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id          INTEGER NOT NULL,
    applicant_id    INTEGER NOT NULL,
    cover_letter    TEXT    NOT NULL DEFAULT '',
    -- Server-generated random filename actually stored on disk.
    resume_stored   TEXT    NOT NULL,
    -- Original extension only (for display / download naming), never used
    -- to build a filesystem path.
    resume_ext      TEXT    NOT NULL,
    status          TEXT    NOT NULL DEFAULT 'submitted'
                            CHECK (status IN ('submitted', 'reviewed', 'rejected', 'accepted')),
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (job_id)       REFERENCES jobs (id)  ON DELETE CASCADE,
    FOREIGN KEY (applicant_id) REFERENCES users (id) ON DELETE CASCADE,
    -- One application per applicant per job.
    UNIQUE (job_id, applicant_id)
);

CREATE INDEX IF NOT EXISTS idx_jobs_employer       ON jobs (employer_id);
CREATE INDEX IF NOT EXISTS idx_apps_job            ON applications (job_id);
CREATE INDEX IF NOT EXISTS idx_apps_applicant      ON applications (applicant_id);
