require('dotenv').config();

const path = require('path');
const axios = require('axios');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const SQLiteStore = require('connect-sqlite3')(session);
const configurePassport = require('./auth');

const app = express();
const port = Number(process.env.PORT || 5090);

configurePassport(passport);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    store: new SQLiteStore({
      db: 'sessions.sqlite',
      dir: path.join(__dirname, '..', 'data')
    }),
    name: 'oauth_profile.sid',
    secret: process.env.SESSION_SECRET || 'development-only-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      maxAge: 1000 * 60 * 60 * 24
    }
  })
);

app.use(passport.initialize());
app.use(passport.session());

app.use((req, res, next) => {
  res.locals.currentUser = req.user || null;
  next();
});

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) {
    next();
    return;
  }

  res.redirect('/');
}

app.get('/', (req, res) => {
  if (req.isAuthenticated()) {
    res.redirect('/account');
    return;
  }

  res.render('home', {
    missingConfig: !process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET
  });
});

app.get('/auth/github', passport.authenticate('github', { scope: ['read:user', 'user:email'] }));

app.get(
  '/auth/github/callback',
  passport.authenticate('github', {
    failureRedirect: '/?login=failed'
  }),
  (req, res) => {
    res.redirect('/account');
  }
);

app.get('/account', requireAuth, async (req, res, next) => {
  try {
    const githubResponse = await axios.get('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${req.user.access_token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'oauth-profile-express-app'
      }
    });

    res.render('account', {
      profile: req.user,
      accountData: githubResponse.data
    });
  } catch (err) {
    next(err);
  }
});

app.post('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) {
      next(err);
      return;
    }

    req.session.destroy(() => {
      res.clearCookie('oauth_profile.sid');
      res.redirect('/');
    });
  });
});

app.use((err, req, res, next) => {
  res.status(500).render('error', {
    message: err.message || 'Something went wrong.'
  });
});

app.listen(port, () => {
  console.log(`OAuth profile app listening at http://localhost:${port}`);
});
