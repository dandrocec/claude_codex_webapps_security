'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const passport = require('passport');

const { configurePassport } = require('./auth');
const { getAccountData } = require('./github');

const PORT = process.env.PORT || 5090;
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-insecure-secret-change-me';

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// Sessions are persisted in SQLite (data/sessions.sqlite) so they survive
// restarts and are not held only in memory.
app.use(
  session({
    store: new SQLiteStore({ db: 'sessions.sqlite', dir: path.join(__dirname, 'data') }),
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    },
  })
);

configurePassport();
app.use(passport.initialize());
app.use(passport.session());

// Make the current user available to all views.
app.use((req, res, next) => {
  res.locals.currentUser = req.user || null;
  next();
});

function ensureAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect('/');
}

// --- Routes ---------------------------------------------------------------

app.get('/', (req, res) => {
  const configured = Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
  res.render('index', { configured });
});

// Kick off the OAuth flow.
app.get('/auth/github', passport.authenticate('github'));

// OAuth provider redirects back here.
app.get(
  '/auth/github/callback',
  passport.authenticate('github', { failureRedirect: '/?error=auth_failed' }),
  (req, res) => res.redirect('/dashboard')
);

// Personalised page. Calls the provider's API on the user's behalf to show
// live account data.
app.get('/dashboard', ensureAuth, async (req, res) => {
  let account = null;
  let apiError = null;
  try {
    account = await getAccountData(req.user.access_token);
  } catch (err) {
    apiError = err.message;
  }
  res.render('dashboard', { user: req.user, account, apiError });
});

app.post('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy(() => res.redirect('/'));
  });
});

// --- Start ----------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`\n  App running at http://localhost:${PORT}`);
  if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) {
    console.log('  ⚠  GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET not set — see README / .env.example');
  }
  console.log('');
});
