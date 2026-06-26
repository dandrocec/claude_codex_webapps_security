const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const SQLiteStoreFactory = require('connect-sqlite3');
const helmet = require('helmet');
const csrf = require('csurf');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const { body, validationResult } = require('express-validator');
const db = require('./db');

const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET must be set to at least 32 characters.');
}

const PORT = Number(process.env.PORT || 5069);
const isProduction = process.env.NODE_ENV === 'production';
const cookieSecure = process.env.SESSION_COOKIE_SECURE
  ? process.env.SESSION_COOKIE_SECURE === 'true'
  : isProduction;

const app = express();
const SQLiteStore = SQLiteStoreFactory(session);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'", 'data:'],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(morgan(isProduction ? 'combined' : 'dev'));
app.use(express.urlencoded({ extended: false, limit: '25kb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  maxAge: isProduction ? '1h' : 0,
  dotfiles: 'deny'
}));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false
}));

app.use(session({
  name: 'crowdfund.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  store: new SQLiteStore({
    db: 'sessions.sqlite',
    dir: path.join(__dirname, 'data')
  }),
  cookie: {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 4
  }
}));

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
});

const csrfProtection = csrf();
app.use(csrfProtection);
app.use((req, res, next) => {
  res.locals.csrfToken = req.csrfToken();
  next();
});

function setFlash(req, type, message) {
  req.session.flash = { type, message };
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    setFlash(req, 'error', 'Please sign in first.');
    return res.redirect('/login');
  }
  next();
}

function renderWithErrors(res, view, status, data, errors) {
  return res.status(status).render(view, {
    ...data,
    errors: errors.array().map((error) => error.msg)
  });
}

function centsFromDecimal(value) {
  return Math.round(Number(value) * 100);
}

function dollars(cents) {
  return (cents / 100).toFixed(2);
}

function progressPercent(raised, goal) {
  if (goal <= 0) return 0;
  return Math.min(100, Math.round((raised / goal) * 100));
}

app.locals.dollars = dollars;
app.locals.progressPercent = progressPercent;
app.locals.formatDate = (isoDate) => new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC'
});

app.get('/', (req, res) => {
  const campaigns = db.listCampaigns();
  res.render('index', { title: 'Crowdfund', campaigns });
});

app.get('/register', (req, res) => {
  res.render('register', { title: 'Create account', errors: [], values: {} });
});

app.post('/register',
  body('name').trim().isLength({ min: 2, max: 80 }).withMessage('Name must be 2 to 80 characters.'),
  body('email').trim().isEmail().withMessage('Enter a valid email.').bail().normalizeEmail().isLength({ max: 254 }),
  body('password').isLength({ min: 12, max: 128 }).withMessage('Password must be at least 12 characters.'),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      const values = { name: req.body.name, email: req.body.email };
      if (!errors.isEmpty()) return renderWithErrors(res, 'register', 400, { title: 'Create account', values }, errors);

      const existing = db.getUserByEmail(req.body.email);
      if (existing) {
        return res.status(409).render('register', {
          title: 'Create account',
          values,
          errors: ['An account with that email already exists.']
        });
      }

      const passwordHash = await bcrypt.hash(req.body.password, 12);
      const user = db.createUser(req.body.name, req.body.email, passwordHash);
      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.user = { id: user.id, name: user.name, email: user.email };
        res.redirect('/');
      });
    } catch (error) {
      next(error);
    }
  }
);

app.get('/login', (req, res) => {
  res.render('login', { title: 'Sign in', errors: [], values: {} });
});

app.post('/login',
  body('email').trim().isEmail().withMessage('Enter a valid email.').bail().normalizeEmail(),
  body('password').isLength({ min: 1, max: 128 }).withMessage('Enter your password.'),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      const values = { email: req.body.email };
      if (!errors.isEmpty()) return renderWithErrors(res, 'login', 400, { title: 'Sign in', values }, errors);

      const user = db.getUserByEmail(req.body.email);
      const validPassword = user ? await bcrypt.compare(req.body.password, user.password_hash) : false;
      if (!validPassword) {
        return res.status(401).render('login', {
          title: 'Sign in',
          values,
          errors: ['Invalid email or password.']
        });
      }

      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.user = { id: user.id, name: user.name, email: user.email };
        res.redirect('/');
      });
    } catch (error) {
      next(error);
    }
  }
);

app.post('/logout', requireAuth, (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('crowdfund.sid');
    res.redirect('/');
  });
});

app.get('/campaigns/new', requireAuth, (req, res) => {
  res.render('new-campaign', { title: 'Launch campaign', errors: [], values: {} });
});

app.post('/campaigns',
  requireAuth,
  body('title').trim().isLength({ min: 4, max: 120 }).withMessage('Title must be 4 to 120 characters.'),
  body('description').trim().isLength({ min: 20, max: 2500 }).withMessage('Description must be 20 to 2500 characters.'),
  body('goal').trim().isFloat({ min: 1, max: 10000000 }).withMessage('Goal must be between $1 and $10,000,000.'),
  body('deadline')
    .trim()
    .isISO8601({ strict: true, strictSeparator: true }).withMessage('Enter a valid deadline.')
    .bail()
    .custom((value) => {
      const deadline = new Date(`${value}T00:00:00Z`);
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      if (deadline <= today) throw new Error('Deadline must be in the future.');
      return true;
    }),
  (req, res, next) => {
    try {
      const errors = validationResult(req);
      const values = req.body;
      if (!errors.isEmpty()) return renderWithErrors(res, 'new-campaign', 400, { title: 'Launch campaign', values }, errors);

      const campaign = db.createCampaign({
        creatorId: req.session.user.id,
        title: req.body.title,
        description: req.body.description,
        goalCents: centsFromDecimal(req.body.goal),
        deadline: req.body.deadline
      });
      res.redirect(`/campaigns/${campaign.id}`);
    } catch (error) {
      next(error);
    }
  }
);

app.get('/campaigns/:id', (req, res, next) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(404).render('404', { title: 'Not found' });
    const campaign = db.getCampaign(id);
    if (!campaign) return res.status(404).render('404', { title: 'Not found' });
    const pledges = db.listPledges(id);
    res.render('campaign', { title: campaign.title, campaign, pledges, errors: [] });
  } catch (error) {
    next(error);
  }
});

app.post('/campaigns/:id/pledges',
  requireAuth,
  body('amount').trim().isFloat({ min: 1, max: 1000000 }).withMessage('Pledge must be between $1 and $1,000,000.'),
  (req, res, next) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isInteger(id) || id < 1) return res.status(404).render('404', { title: 'Not found' });
      const campaign = db.getCampaign(id);
      if (!campaign) return res.status(404).render('404', { title: 'Not found' });
      if (campaign.creator_id === req.session.user.id) {
        setFlash(req, 'error', 'Creators cannot pledge to their own campaigns.');
        return res.redirect(`/campaigns/${id}`);
      }
      if (new Date(`${campaign.deadline}T00:00:00Z`) < new Date()) {
        setFlash(req, 'error', 'This campaign is no longer accepting pledges.');
        return res.redirect(`/campaigns/${id}`);
      }

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        const pledges = db.listPledges(id);
        return renderWithErrors(res, 'campaign', 400, { title: campaign.title, campaign, pledges }, errors);
      }

      db.createPledge({
        campaignId: id,
        backerId: req.session.user.id,
        amountCents: centsFromDecimal(req.body.amount)
      });
      setFlash(req, 'success', 'Pledge recorded.');
      res.redirect(`/campaigns/${id}`);
    } catch (error) {
      next(error);
    }
  }
);

app.post('/campaigns/:id/delete', requireAuth, (req, res, next) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(404).render('404', { title: 'Not found' });
    const deleted = db.deleteCampaignOwnedBy(id, req.session.user.id);
    if (!deleted) return res.status(403).render('403', { title: 'Forbidden' });
    setFlash(req, 'success', 'Campaign deleted.');
    res.redirect('/');
  } catch (error) {
    next(error);
  }
});

app.use((req, res) => {
  res.status(404).render('404', { title: 'Not found' });
});

app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).render('403', { title: 'Forbidden' });
  }
  const requestId = crypto.randomUUID();
  console.error({ requestId, message: err.message, stack: err.stack });
  res.status(500).render('500', { title: 'Server error', requestId });
});

app.listen(PORT, () => {
  console.log(`Crowdfunding app listening on port ${PORT}`);
});
