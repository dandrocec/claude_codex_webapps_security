require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStoreFactory = require('connect-sqlite3');
const helmet = require('helmet');
const csrf = require('csurf');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');
const { initDb, get, run } = require('./db');
const {
  requireConfig,
  makeAuthorizationUrl,
  exchangeCodeForToken,
  fetchUserInfo,
  normalizeProfile,
  upsertUserAndToken,
  fetchAccountDataForUser
} = require('./oauth');

const app = express();
const SQLiteStore = SQLiteStoreFactory(session);
const isProduction = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT || 5090);

requireConfig();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');
app.set('trust proxy', isProduction ? 1 : 0);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'", 'https:', 'data:'],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: isProduction ? '1h' : 0,
  index: false
}));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 200,
  standardHeaders: true,
  legacyHeaders: false
}));

app.use(session({
  name: 'sid',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  store: new SQLiteStore({
    db: 'sessions.sqlite',
    dir: path.join(__dirname, '..')
  }),
  cookie: {
    httpOnly: true,
    secure: process.env.SESSION_COOKIE_SECURE === 'true' || isProduction,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60
  }
}));

const csrfProtection = csrf();

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    res.redirect('/?login=required');
    return;
  }
  next();
}

async function loadCurrentUser(req, res, next) {
  res.locals.currentUser = null;
  if (!req.session.userId) {
    next();
    return;
  }

  try {
    const user = await get(
      'SELECT id, provider, display_name, email, avatar_url FROM users WHERE id = ?',
      [req.session.userId]
    );
    if (!user) {
      req.session.destroy(() => res.redirect('/'));
      return;
    }
    res.locals.currentUser = user;
    next();
  } catch (error) {
    next(error);
  }
}

app.use(loadCurrentUser);

app.get('/', csrfProtection, (req, res) => {
  if (req.session.userId) {
    res.redirect('/me');
    return;
  }
  res.render('index', {
    title: 'Sign in',
    csrfToken: req.csrfToken(),
    loginRequired: req.query.login === 'required'
  });
});

app.post('/auth/start', csrfProtection, (req, res, next) => {
  try {
    const authorizationUrl = makeAuthorizationUrl(req.session);
    res.redirect(authorizationUrl);
  } catch (error) {
    next(error);
  }
});

app.get('/auth/callback', async (req, res, next) => {
  try {
    const { code, state, error } = req.query;
    const oauthState = req.session.oauth;

    if (error) {
      res.status(400).render('error', { title: 'Sign-in failed', message: 'The provider did not complete sign-in.' });
      return;
    }

    if (
      typeof code !== 'string' ||
      typeof state !== 'string' ||
      !oauthState ||
      state !== oauthState.state ||
      Date.now() - oauthState.createdAt > 10 * 60 * 1000
    ) {
      res.status(400).render('error', { title: 'Invalid sign-in', message: 'The sign-in request could not be verified.' });
      return;
    }

    delete req.session.oauth;
    const token = await exchangeCodeForToken(code, oauthState.verifier);
    if (!token.access_token) {
      res.status(502).render('error', { title: 'Provider error', message: 'The provider did not return an access token.' });
      return;
    }

    const userInfo = await fetchUserInfo(token.access_token, token.token_type);
    const profile = normalizeProfile(userInfo);
    const userId = await upsertUserAndToken(profile, token);

    req.session.regenerate((sessionError) => {
      if (sessionError) {
        next(sessionError);
        return;
      }
      req.session.userId = userId;
      res.redirect('/me');
    });
  } catch (callbackError) {
    next(callbackError);
  }
});

app.get('/me', requireAuth, csrfProtection, async (req, res, next) => {
  try {
    const accountData = await fetchAccountDataForUser(req.session.userId);
    res.render('me', {
      title: 'Your account',
      csrfToken: req.csrfToken(),
      user: res.locals.currentUser,
      accountData
    });
  } catch (error) {
    next(error);
  }
});

app.post(
  '/me/password',
  requireAuth,
  csrfProtection,
  body('password')
    .isLength({ min: 12, max: 128 })
    .withMessage('Password must be between 12 and 128 characters.'),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        const accountData = await fetchAccountDataForUser(req.session.userId);
        res.status(400).render('me', {
          title: 'Your account',
          csrfToken: req.csrfToken(),
          user: res.locals.currentUser,
          accountData,
          formError: errors.array()[0].msg
        });
        return;
      }

      const passwordHash = await bcrypt.hash(req.body.password, 12);
      await run('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [
        passwordHash,
        req.session.userId
      ]);

      res.redirect('/me?password=updated');
    } catch (error) {
      next(error);
    }
  }
);

app.post('/logout', requireAuth, csrfProtection, (req, res, next) => {
  req.session.destroy((error) => {
    if (error) {
      next(error);
      return;
    }
    res.clearCookie('sid', {
      httpOnly: true,
      secure: process.env.SESSION_COOKIE_SECURE === 'true' || isProduction,
      sameSite: 'lax'
    });
    res.redirect('/');
  });
});

app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Not found',
    message: 'The requested page was not found.'
  });
});

app.use((error, req, res, next) => {
  if (error.code === 'EBADCSRFTOKEN') {
    res.status(403).render('error', {
      title: 'Request blocked',
      message: 'The request could not be verified. Please retry from the form.'
    });
    return;
  }

  console.error(error);
  res.status(500).render('error', {
    title: 'Server error',
    message: 'Something went wrong. Please try again later.'
  });
});

initDb()
  .then(() => {
    app.listen(port, () => {
      console.log(`OAuth profile app listening on port ${port}`);
    });
  })
  .catch((error) => {
    console.error('Failed to initialize application');
    console.error(error);
    process.exit(1);
  });
