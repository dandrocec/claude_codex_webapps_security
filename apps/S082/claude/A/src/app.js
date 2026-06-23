'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');

const { loadUser } = require('./auth');
const accountsRoutes = require('./routes/accounts');
const filesRoutes = require('./routes/files');
const sharesRoutes = require('./routes/shares');

const PORT = process.env.PORT || 5082;
const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-only-insecure-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 7 },
  })
);
app.use(flash());

// Expose flash messages and the current user to every view.
app.use((req, res, next) => {
  res.locals.messages = { error: req.flash('error'), success: req.flash('success') };
  res.locals.baseUrl = `${req.protocol}://${req.get('host')}`;
  next();
});
app.use(loadUser);

app.use('/', accountsRoutes);
app.use('/', sharesRoutes);
app.use('/', filesRoutes);

// 404 fallback.
app.use((req, res) => {
  res.status(404).render('error', { message: 'Page not found.' });
});

// Error handler (e.g. multer "file too large").
app.use((err, req, res, next) => {
  console.error(err);
  const message =
    err && err.code === 'LIMIT_FILE_SIZE'
      ? 'That file is too large (50 MB max).'
      : 'Something went wrong.';
  res.status(400).render('error', { message });
});

app.listen(PORT, () => {
  console.log(`File-storage app running at http://localhost:${PORT}`);
});
