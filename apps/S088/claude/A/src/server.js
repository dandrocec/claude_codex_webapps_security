'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);

const { DATA_DIR } = require('./db');

const app = express();
const PORT = process.env.PORT || 5088;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    store: new SQLiteStore({ db: 'sessions.db', dir: DATA_DIR }),
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 24 * 7 },
  })
);

// API routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/groups', require('./routes/groups'));
app.use('/api/folders', require('./routes/folders'));
app.use('/api/documents', require('./routes/documents'));
app.use('/api/shares', require('./routes/shares'));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Static front-end
app.use(express.static(path.join(__dirname, '..', 'public')));

// Centralised error handler — Multer and thrown route errors land here.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'file too large (max 50MB)' });
  }
  res.status(500).json({ error: err.message || 'internal server error' });
});

app.listen(PORT, () => {
  console.log(`Document management system running at http://localhost:${PORT}`);
});
