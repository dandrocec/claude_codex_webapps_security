'use strict';

const path = require('path');
const Database = require('better-sqlite3');

// Single shared SQLite connection for the whole app.
const dbPath = path.join(__dirname, 'warehouse.db');
const db = new Database(dbPath);

// Enforce foreign keys and use a sane journal mode for concurrent reads.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

module.exports = db;
