-- Schema for the real-estate site (SQLite).
-- Loaded automatically on first run by src/Database.php.

CREATE TABLE IF NOT EXISTS agents (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    email         TEXT    NOT NULL UNIQUE,
    phone         TEXT,
    password_hash TEXT    NOT NULL,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS listings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id    INTEGER NOT NULL,
    title       TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    price       INTEGER NOT NULL DEFAULT 0,        -- whole currency units
    location    TEXT    NOT NULL DEFAULT '',       -- city / area, used for filtering
    address     TEXT    NOT NULL DEFAULT '',
    bedrooms    INTEGER NOT NULL DEFAULT 0,
    bathrooms   INTEGER NOT NULL DEFAULT 0,
    area_sqft   INTEGER NOT NULL DEFAULT 0,
    property_type TEXT  NOT NULL DEFAULT 'House',
    status      TEXT    NOT NULL DEFAULT 'active',
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (agent_id) REFERENCES agents (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS photos (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id INTEGER NOT NULL,
    filename   TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (listing_id) REFERENCES listings (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id  INTEGER NOT NULL,
    agent_id    INTEGER NOT NULL,
    sender_name TEXT    NOT NULL,
    sender_email TEXT   NOT NULL,
    sender_phone TEXT,
    body        TEXT    NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (listing_id) REFERENCES listings (id) ON DELETE CASCADE,
    FOREIGN KEY (agent_id) REFERENCES agents (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_listings_price    ON listings (price);
CREATE INDEX IF NOT EXISTS idx_listings_location ON listings (location);
CREATE INDEX IF NOT EXISTS idx_photos_listing    ON photos (listing_id);
