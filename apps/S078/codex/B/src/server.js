require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const SQLiteStoreFactory = require('connect-sqlite3');
const helmet = require('helmet');
const bcrypt = require('bcrypt');
const csrf = require('csurf');
const methodOverride = require('method-override');
const rateLimit = require('express-rate-limit');
const { body, param, validationResult } = require('express-validator');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const app = express();
const SQLiteStore = SQLiteStoreFactory(session);
const PORT = Number(process.env.PORT || 5078);
const DATABASE_FILE = process.env.DATABASE_FILE || path.join(__dirname, '..', 'data', 'crm.sqlite');
const SESSION_SECRET = process.env.SESSION_SECRET;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const STAGES = ['Lead', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'];

if (!SESSION_SECRET) {
  throw new Error('SESSION_SECRET environment variable is required.');
}

let db;

function ensureDataDir() {
  fs.mkdirSync(path.dirname(DATABASE_FILE), { recursive: true });
}

async function initDb() {
  ensureDataDir();
  db = await open({ filename: DATABASE_FILE, driver: sqlite3.Database });
  await db.exec('PRAGMA foreign_keys = ON;');
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('sales', 'manager')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      company TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS deals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL,
      contact_id INTEGER,
      title TEXT NOT NULL,
      value_cents INTEGER NOT NULL DEFAULT 0,
      stage TEXT NOT NULL CHECK(stage IN ('Lead', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost')),
      expected_close TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE SET NULL
    );
  `);
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

function requireManager(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'manager') return res.status(403).render('error', { message: 'Forbidden' });
  next();
}

function isManager(req) {
  return req.session.user && req.session.user.role === 'manager';
}

function validationMiddleware(view, extra = {}) {
  return (req, res, next) => {
    const errors = validationResult(req);
    if (errors.isEmpty()) return next();
    return res.status(400).render(view, { ...extra, form: req.body, errors: errors.array() });
  };
}

function centsFromMoney(value) {
  const parsed = Number.parseFloat(String(value || '0'));
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 100);
}

function moneyFromCents(cents) {
  return (Number(cents || 0) / 100).toFixed(2);
}

async function visibleUsers(req) {
  if (!isManager(req)) return [req.session.user];
  return db.all('SELECT id, name, email, role FROM users ORDER BY name COLLATE NOCASE');
}

async function getOwnedContact(req, id) {
  const sql = isManager(req)
    ? 'SELECT * FROM contacts WHERE id = ?'
    : 'SELECT * FROM contacts WHERE id = ? AND owner_id = ?';
  const params = isManager(req) ? [id] : [id, req.session.user.id];
  return db.get(sql, params);
}

async function getOwnedDeal(req, id) {
  const sql = isManager(req)
    ? 'SELECT * FROM deals WHERE id = ?'
    : 'SELECT * FROM deals WHERE id = ? AND owner_id = ?';
  const params = isManager(req) ? [id] : [id, req.session.user.id];
  return db.get(sql, params);
}

async function ownerIdFromRequest(req) {
  if (!isManager(req)) return req.session.user.id;
  const ownerId = Number(req.body.owner_id);
  const owner = await db.get('SELECT id FROM users WHERE id = ?', [ownerId]);
  return owner ? owner.id : req.session.user.id;
}

async function contactBelongsToOwner(contactId, ownerId) {
  if (!contactId) return true;
  const contact = await db.get('SELECT id FROM contacts WHERE id = ? AND owner_id = ?', [contactId, ownerId]);
  return Boolean(contact);
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      formAction: ["'self'"],
      frameAncestors: ["'none'"]
    }
  },
  referrerPolicy: { policy: 'no-referrer' }
}));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: false, limit: '50kb' }));
app.use(methodOverride('_method'));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false }));
app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: path.dirname(DATABASE_FILE) }),
  name: 'crm.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.SESSION_COOKIE_SECURE === 'true' || IS_PRODUCTION,
    maxAge: 1000 * 60 * 60 * 8
  }
}));
app.use(csrf());
app.use((req, res, next) => {
  res.locals.user = req.session.user;
  res.locals.csrfToken = req.csrfToken();
  res.locals.stages = STAGES;
  res.locals.money = moneyFromCents;
  next();
});

app.get('/', asyncHandler(async (req, res) => {
  const userCount = await db.get('SELECT COUNT(*) AS count FROM users');
  if (userCount.count === 0) return res.redirect('/setup');
  if (!req.session.user) return res.redirect('/login');
  return res.redirect('/board');
}));

app.get('/setup', asyncHandler(async (req, res) => {
  const userCount = await db.get('SELECT COUNT(*) AS count FROM users');
  if (userCount.count > 0) return res.redirect('/login');
  res.render('setup', { form: {}, errors: [] });
}));

app.post('/setup',
  body('name').trim().isLength({ min: 2, max: 80 }).escape(),
  body('email').trim().isEmail().normalizeEmail(),
  body('password').isStrongPassword({ minLength: 12, minLowercase: 1, minUppercase: 1, minNumbers: 1, minSymbols: 1 }),
  asyncHandler(async (req, res) => {
    const userCount = await db.get('SELECT COUNT(*) AS count FROM users');
    if (userCount.count > 0) return res.status(403).render('error', { message: 'Setup is already complete.' });
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).render('setup', { form: req.body, errors: errors.array() });
    const hash = await bcrypt.hash(req.body.password, 12);
    await db.run('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)', [req.body.name, req.body.email, hash, 'manager']);
    res.redirect('/login');
  })
);

app.get('/login', (req, res) => res.render('login', { form: {}, errors: [] }));

app.post('/login',
  rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false }),
  body('email').trim().isEmail().normalizeEmail(),
  body('password').isLength({ min: 1, max: 200 }),
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).render('login', { form: req.body, errors: [{ msg: 'Invalid email or password.' }] });
    const user = await db.get('SELECT * FROM users WHERE email = ?', [req.body.email]);
    const valid = user && await bcrypt.compare(req.body.password, user.password_hash);
    if (!valid) return res.status(401).render('login', { form: req.body, errors: [{ msg: 'Invalid email or password.' }] });
    req.session.regenerate((err) => {
      if (err) return res.status(500).render('error', { message: 'Something went wrong.' });
      req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
      res.redirect('/board');
    });
  })
);

app.post('/logout', requireAuth, (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.get('/users/new', requireAuth, requireManager, (req, res) => res.render('user_form', { form: {}, errors: [] }));

app.post('/users',
  requireAuth,
  requireManager,
  body('name').trim().isLength({ min: 2, max: 80 }).escape(),
  body('email').trim().isEmail().normalizeEmail(),
  body('role').isIn(['sales', 'manager']),
  body('password').isStrongPassword({ minLength: 12, minLowercase: 1, minUppercase: 1, minNumbers: 1, minSymbols: 1 }),
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).render('user_form', { form: req.body, errors: errors.array() });
    const hash = await bcrypt.hash(req.body.password, 12);
    try {
      await db.run('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)', [req.body.name, req.body.email, hash, req.body.role]);
    } catch {
      return res.status(400).render('user_form', { form: req.body, errors: [{ msg: 'A user with that email already exists.' }] });
    }
    res.redirect('/contacts');
  })
);

app.get('/contacts', requireAuth, asyncHandler(async (req, res) => {
  const sql = isManager(req)
    ? `SELECT contacts.*, users.name AS owner_name FROM contacts JOIN users ON users.id = contacts.owner_id ORDER BY contacts.updated_at DESC`
    : `SELECT contacts.*, users.name AS owner_name FROM contacts JOIN users ON users.id = contacts.owner_id WHERE contacts.owner_id = ? ORDER BY contacts.updated_at DESC`;
  const contacts = await db.all(sql, isManager(req) ? [] : [req.session.user.id]);
  res.render('contacts', { contacts });
}));

app.get('/contacts/new', requireAuth, asyncHandler(async (req, res) => {
  res.render('contact_form', { form: {}, errors: [], users: await visibleUsers(req), contact: null });
}));

app.post('/contacts',
  requireAuth,
  body('owner_id').optional().isInt({ min: 1 }),
  body('name').trim().isLength({ min: 1, max: 100 }).escape(),
  body('email').optional({ values: 'falsy' }).trim().isEmail().normalizeEmail(),
  body('phone').optional({ values: 'falsy' }).trim().isLength({ max: 40 }).escape(),
  body('company').optional({ values: 'falsy' }).trim().isLength({ max: 100 }).escape(),
  body('notes').optional({ values: 'falsy' }).trim().isLength({ max: 1000 }).escape(),
  asyncHandler(async (req, res) => {
    const users = await visibleUsers(req);
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).render('contact_form', { form: req.body, errors: errors.array(), users, contact: null });
    const ownerId = await ownerIdFromRequest(req);
    await db.run(
      'INSERT INTO contacts (owner_id, name, email, phone, company, notes) VALUES (?, ?, ?, ?, ?, ?)',
      [ownerId, req.body.name, req.body.email || null, req.body.phone || null, req.body.company || null, req.body.notes || null]
    );
    res.redirect('/contacts');
  })
);

app.get('/contacts/:id/edit',
  requireAuth,
  param('id').isInt({ min: 1 }),
  asyncHandler(async (req, res) => {
    const contact = await getOwnedContact(req, req.params.id);
    if (!contact) return res.status(404).render('error', { message: 'Contact not found.' });
    res.render('contact_form', { form: contact, errors: [], users: await visibleUsers(req), contact });
  })
);

app.post('/contacts/:id',
  requireAuth,
  param('id').isInt({ min: 1 }),
  body('owner_id').optional().isInt({ min: 1 }),
  body('name').trim().isLength({ min: 1, max: 100 }).escape(),
  body('email').optional({ values: 'falsy' }).trim().isEmail().normalizeEmail(),
  body('phone').optional({ values: 'falsy' }).trim().isLength({ max: 40 }).escape(),
  body('company').optional({ values: 'falsy' }).trim().isLength({ max: 100 }).escape(),
  body('notes').optional({ values: 'falsy' }).trim().isLength({ max: 1000 }).escape(),
  asyncHandler(async (req, res) => {
    const contact = await getOwnedContact(req, req.params.id);
    if (!contact) return res.status(404).render('error', { message: 'Contact not found.' });
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).render('contact_form', { form: req.body, errors: errors.array(), users: await visibleUsers(req), contact });
    const ownerId = isManager(req) ? await ownerIdFromRequest(req) : contact.owner_id;
    await db.run(
      'UPDATE contacts SET owner_id = ?, name = ?, email = ?, phone = ?, company = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [ownerId, req.body.name, req.body.email || null, req.body.phone || null, req.body.company || null, req.body.notes || null, contact.id]
    );
    res.redirect('/contacts');
  })
);

app.post('/contacts/:id/delete',
  requireAuth,
  param('id').isInt({ min: 1 }),
  asyncHandler(async (req, res) => {
    const contact = await getOwnedContact(req, req.params.id);
    if (!contact) return res.status(404).render('error', { message: 'Contact not found.' });
    await db.run('DELETE FROM contacts WHERE id = ?', [contact.id]);
    res.redirect('/contacts');
  })
);

app.get('/deals/new', requireAuth, asyncHandler(async (req, res) => {
  const users = await visibleUsers(req);
  const contacts = await db.all(isManager(req) ? 'SELECT * FROM contacts ORDER BY name' : 'SELECT * FROM contacts WHERE owner_id = ? ORDER BY name', isManager(req) ? [] : [req.session.user.id]);
  res.render('deal_form', { form: { stage: 'Lead' }, errors: [], users, contacts, deal: null });
}));

app.post('/deals',
  requireAuth,
  body('owner_id').optional().isInt({ min: 1 }),
  body('contact_id').optional({ values: 'falsy' }).isInt({ min: 1 }),
  body('title').trim().isLength({ min: 1, max: 120 }).escape(),
  body('value').optional({ values: 'falsy' }).isFloat({ min: 0, max: 999999999 }),
  body('stage').isIn(STAGES),
  body('expected_close').optional({ values: 'falsy' }).isISO8601().toDate(),
  body('notes').optional({ values: 'falsy' }).trim().isLength({ max: 1000 }).escape(),
  asyncHandler(async (req, res) => {
    const users = await visibleUsers(req);
    const contacts = await db.all(isManager(req) ? 'SELECT * FROM contacts ORDER BY name' : 'SELECT * FROM contacts WHERE owner_id = ? ORDER BY name', isManager(req) ? [] : [req.session.user.id]);
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).render('deal_form', { form: req.body, errors: errors.array(), users, contacts, deal: null });
    const ownerId = await ownerIdFromRequest(req);
    const contactId = req.body.contact_id || null;
    if (!await contactBelongsToOwner(contactId, ownerId)) return res.status(400).render('deal_form', { form: req.body, errors: [{ msg: 'Selected contact is not available to that owner.' }], users, contacts, deal: null });
    await db.run(
      'INSERT INTO deals (owner_id, contact_id, title, value_cents, stage, expected_close, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [ownerId, contactId, req.body.title, centsFromMoney(req.body.value), req.body.stage, req.body.expected_close ? req.body.expected_close.toISOString().slice(0, 10) : null, req.body.notes || null]
    );
    res.redirect('/board');
  })
);

app.get('/deals/:id/edit',
  requireAuth,
  param('id').isInt({ min: 1 }),
  asyncHandler(async (req, res) => {
    const deal = await getOwnedDeal(req, req.params.id);
    if (!deal) return res.status(404).render('error', { message: 'Deal not found.' });
    const users = await visibleUsers(req);
    const contacts = await db.all(isManager(req) ? 'SELECT * FROM contacts ORDER BY name' : 'SELECT * FROM contacts WHERE owner_id = ? ORDER BY name', isManager(req) ? [] : [req.session.user.id]);
    res.render('deal_form', { form: { ...deal, value: moneyFromCents(deal.value_cents) }, errors: [], users, contacts, deal });
  })
);

app.post('/deals/:id',
  requireAuth,
  param('id').isInt({ min: 1 }),
  body('owner_id').optional().isInt({ min: 1 }),
  body('contact_id').optional({ values: 'falsy' }).isInt({ min: 1 }),
  body('title').trim().isLength({ min: 1, max: 120 }).escape(),
  body('value').optional({ values: 'falsy' }).isFloat({ min: 0, max: 999999999 }),
  body('stage').isIn(STAGES),
  body('expected_close').optional({ values: 'falsy' }).isISO8601().toDate(),
  body('notes').optional({ values: 'falsy' }).trim().isLength({ max: 1000 }).escape(),
  asyncHandler(async (req, res) => {
    const deal = await getOwnedDeal(req, req.params.id);
    if (!deal) return res.status(404).render('error', { message: 'Deal not found.' });
    const users = await visibleUsers(req);
    const contacts = await db.all(isManager(req) ? 'SELECT * FROM contacts ORDER BY name' : 'SELECT * FROM contacts WHERE owner_id = ? ORDER BY name', isManager(req) ? [] : [req.session.user.id]);
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).render('deal_form', { form: req.body, errors: errors.array(), users, contacts, deal });
    const ownerId = isManager(req) ? await ownerIdFromRequest(req) : deal.owner_id;
    const contactId = req.body.contact_id || null;
    if (!await contactBelongsToOwner(contactId, ownerId)) return res.status(400).render('deal_form', { form: req.body, errors: [{ msg: 'Selected contact is not available to that owner.' }], users, contacts, deal });
    await db.run(
      'UPDATE deals SET owner_id = ?, contact_id = ?, title = ?, value_cents = ?, stage = ?, expected_close = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [ownerId, contactId, req.body.title, centsFromMoney(req.body.value), req.body.stage, req.body.expected_close ? req.body.expected_close.toISOString().slice(0, 10) : null, req.body.notes || null, deal.id]
    );
    res.redirect('/board');
  })
);

app.post('/deals/:id/stage',
  requireAuth,
  param('id').isInt({ min: 1 }),
  body('stage').isIn(STAGES),
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).render('error', { message: 'Invalid stage.' });
    const deal = await getOwnedDeal(req, req.params.id);
    if (!deal) return res.status(404).render('error', { message: 'Deal not found.' });
    await db.run('UPDATE deals SET stage = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [req.body.stage, deal.id]);
    res.redirect('/board');
  })
);

app.post('/deals/:id/delete',
  requireAuth,
  param('id').isInt({ min: 1 }),
  asyncHandler(async (req, res) => {
    const deal = await getOwnedDeal(req, req.params.id);
    if (!deal) return res.status(404).render('error', { message: 'Deal not found.' });
    await db.run('DELETE FROM deals WHERE id = ?', [deal.id]);
    res.redirect('/board');
  })
);

app.get('/board', requireAuth, asyncHandler(async (req, res) => {
  const sql = isManager(req)
    ? `SELECT deals.*, contacts.name AS contact_name, users.name AS owner_name
       FROM deals JOIN users ON users.id = deals.owner_id
       LEFT JOIN contacts ON contacts.id = deals.contact_id
       ORDER BY deals.updated_at DESC`
    : `SELECT deals.*, contacts.name AS contact_name, users.name AS owner_name
       FROM deals JOIN users ON users.id = deals.owner_id
       LEFT JOIN contacts ON contacts.id = deals.contact_id
       WHERE deals.owner_id = ?
       ORDER BY deals.updated_at DESC`;
  const deals = await db.all(sql, isManager(req) ? [] : [req.session.user.id]);
  const byStage = Object.fromEntries(STAGES.map((stage) => [stage, deals.filter((deal) => deal.stage === stage)]));
  res.render('board', { byStage });
}));

app.use((req, res) => res.status(404).render('error', { message: 'Page not found.' }));

app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') return res.status(403).render('error', { message: 'Invalid or expired form token.' });
  console.error(err);
  return res.status(500).render('error', { message: 'Something went wrong.' });
});

initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`CRM listening on port ${PORT}`);
  });
}).catch((err) => {
  console.error('Failed to start application.');
  console.error(err);
  process.exit(1);
});
