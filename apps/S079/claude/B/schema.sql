-- Schema for the invoicing application.
-- Foreign keys enforce ownership chains; ON DELETE CASCADE keeps data consistent.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clients (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    name       TEXT    NOT NULL,
    email      TEXT,
    address    TEXT,
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS invoices (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    client_id  INTEGER NOT NULL,
    number     TEXT    NOT NULL,
    issue_date TEXT    NOT NULL,
    due_date   TEXT,
    tax_rate   TEXT    NOT NULL DEFAULT '0',   -- stored as text to preserve decimal precision
    status     TEXT    NOT NULL DEFAULT 'draft',
    notes      TEXT,
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id)   REFERENCES users (id)   ON DELETE CASCADE,
    FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS line_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id  INTEGER NOT NULL,
    description TEXT    NOT NULL,
    quantity    TEXT    NOT NULL DEFAULT '0',
    unit_price  TEXT    NOT NULL DEFAULT '0',
    position    INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_clients_user     ON clients (user_id);
CREATE INDEX IF NOT EXISTS idx_invoices_user    ON invoices (user_id);
CREATE INDEX IF NOT EXISTS idx_invoices_client  ON invoices (client_id);
CREATE INDEX IF NOT EXISTS idx_line_items_inv   ON line_items (invoice_id);
