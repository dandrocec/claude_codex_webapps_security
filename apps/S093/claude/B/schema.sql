-- Ledger schema. Money is stored as an integer number of cents to avoid
-- floating-point rounding errors. The CHECK constraint is a hard, database-level
-- guarantee that a balance can never go negative even if application logic fails.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    balance_cents INTEGER NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Transactions are append-only (immutable): the application never issues
-- UPDATE or DELETE against this table.
CREATE TABLE IF NOT EXISTS transactions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id     INTEGER NOT NULL REFERENCES users(id),
    recipient_id  INTEGER NOT NULL REFERENCES users(id),
    amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),
    memo          TEXT    NOT NULL DEFAULT '',
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tx_sender    ON transactions(sender_id, id);
CREATE INDEX IF NOT EXISTS idx_tx_recipient ON transactions(recipient_id, id);
