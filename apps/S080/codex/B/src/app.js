require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const helmet = require('helmet');
const csrf = require('csurf');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const { body, param, validationResult } = require('express-validator');
const {
  db,
  hasUsers,
  findUserByUsername,
  findUserById,
  createUser,
  createOrder
} = require('./db');

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET must be set to at least 32 characters.');
}

const app = express();
const port = Number(process.env.PORT || 5080);
const isProduction = process.env.NODE_ENV === 'production';
const cookieSecure = process.env.SESSION_COOKIE_SECURE === 'false' ? false : isProduction;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"]
    }
  },
  referrerPolicy: { policy: 'no-referrer' }
}));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

app.use(session({
  name: 'warehouse.sid',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  store: new SQLiteStore({
    db: 'sessions.sqlite',
    dir: path.dirname(process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'warehouse.sqlite'))
  }),
  cookie: {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 8
  }
}));

const csrfProtection = csrf();
app.use(csrfProtection);

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.csrfToken = req.csrfToken();
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false
});

function flash(req, type, message) {
  req.session.flash = { type, message };
}

function requireSetup(req, res, next) {
  if (hasUsers()) return res.redirect('/login');
  return next();
}

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  const user = findUserById(req.session.user.id);
  if (!user) {
    req.session.destroy(() => {});
    return res.redirect('/login');
  }
  req.session.user = user;
  res.locals.currentUser = user;
  return next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.session.user || req.session.user.role !== role) {
      return res.status(403).render('error', { title: 'Forbidden', message: 'You do not have access to this page.' });
    }
    return next();
  };
}

function validated(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    req.formErrors = errors.array().map((error) => error.msg);
  }
  next();
}

const usernameRule = body('username')
  .trim()
  .isLength({ min: 3, max: 40 }).withMessage('Username must be 3 to 40 characters.')
  .matches(/^[a-zA-Z0-9_.-]+$/).withMessage('Username may contain letters, numbers, dots, underscores, and hyphens only.');

const passwordRule = body('password')
  .isLength({ min: 12, max: 128 }).withMessage('Password must be 12 to 128 characters long.');

const cleanText = (value) => String(value || '').replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim();

app.get('/', (req, res) => {
  if (!hasUsers()) return res.redirect('/setup');
  if (!req.session.user) return res.redirect('/login');
  return res.redirect('/dashboard');
});

app.get('/setup', requireSetup, (req, res) => {
  res.render('setup', { title: 'Create manager', errors: [] });
});

app.post('/setup',
  requireSetup,
  usernameRule,
  passwordRule,
  validated,
  async (req, res, next) => {
    try {
      if (req.formErrors) return res.status(400).render('setup', { title: 'Create manager', errors: req.formErrors });
      const passwordHash = await bcrypt.hash(req.body.password, 12);
      const result = createUser({ username: req.body.username, passwordHash, role: 'manager' });
      req.session.regenerate((error) => {
        if (error) return next(error);
        req.session.user = { id: Number(result.lastInsertRowid), username: req.body.username, role: 'manager' };
        return res.redirect('/dashboard');
      });
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return res.status(409).render('setup', { title: 'Create manager', errors: ['Username is already taken.'] });
      }
      return next(error);
    }
  }
);

app.get('/login', (req, res) => {
  if (!hasUsers()) return res.redirect('/setup');
  if (req.session.user) return res.redirect('/dashboard');
  return res.render('login', { title: 'Sign in', errors: [] });
});

app.post('/login',
  loginLimiter,
  usernameRule,
  body('password').isLength({ min: 1, max: 128 }).withMessage('Password is required.'),
  validated,
  async (req, res, next) => {
    try {
      if (req.formErrors) return res.status(400).render('login', { title: 'Sign in', errors: ['Invalid username or password.'] });
      const user = findUserByUsername(req.body.username);
      const passwordOk = user ? await bcrypt.compare(req.body.password, user.password_hash) : false;
      if (!passwordOk) {
        return res.status(401).render('login', { title: 'Sign in', errors: ['Invalid username or password.'] });
      }
      req.session.regenerate((error) => {
        if (error) return next(error);
        req.session.user = { id: user.id, username: user.username, role: user.role };
        return res.redirect('/dashboard');
      });
    } catch (error) {
      return next(error);
    }
  }
);

app.post('/logout', requireAuth, (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie('warehouse.sid');
    return res.redirect('/login');
  });
});

app.get('/dashboard', requireAuth, (req, res) => {
  const items = db.prepare('SELECT id, sku, name, quantity FROM items ORDER BY name').all();
  const orders = req.session.user.role === 'manager'
    ? db.prepare(`
        SELECT orders.id, orders.created_at, users.username, items.sku, items.name, order_lines.quantity
        FROM orders
        JOIN users ON users.id = orders.created_by
        JOIN order_lines ON order_lines.order_id = orders.id
        JOIN items ON items.id = order_lines.item_id
        ORDER BY orders.created_at DESC
        LIMIT 50
      `).all()
    : db.prepare(`
        SELECT orders.id, orders.created_at, users.username, items.sku, items.name, order_lines.quantity
        FROM orders
        JOIN users ON users.id = orders.created_by
        JOIN order_lines ON order_lines.order_id = orders.id
        JOIN items ON items.id = order_lines.item_id
        WHERE orders.created_by = ?
        ORDER BY orders.created_at DESC
        LIMIT 50
      `).all(req.session.user.id);
  res.render('dashboard', { title: 'Warehouse', items, orders, errors: [] });
});

app.get('/users', requireAuth, requireRole('manager'), (req, res) => {
  const users = db.prepare('SELECT id, username, role, created_at FROM users ORDER BY username').all();
  res.render('users', { title: 'Users', users, errors: [] });
});

app.post('/users',
  requireAuth,
  requireRole('manager'),
  usernameRule,
  passwordRule,
  body('role').isIn(['clerk', 'manager']).withMessage('Role must be clerk or manager.'),
  validated,
  async (req, res, next) => {
    try {
      const users = db.prepare('SELECT id, username, role, created_at FROM users ORDER BY username').all();
      if (req.formErrors) return res.status(400).render('users', { title: 'Users', users, errors: req.formErrors });
      const passwordHash = await bcrypt.hash(req.body.password, 12);
      createUser({ username: req.body.username, passwordHash, role: req.body.role });
      flash(req, 'success', 'User created.');
      return res.redirect('/users');
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        const users = db.prepare('SELECT id, username, role, created_at FROM users ORDER BY username').all();
        return res.status(409).render('users', { title: 'Users', users, errors: ['Username is already taken.'] });
      }
      return next(error);
    }
  }
);

app.post('/items',
  requireAuth,
  requireRole('manager'),
  body('sku').trim().isLength({ min: 1, max: 40 }).withMessage('SKU must be 1 to 40 characters.').matches(/^[a-zA-Z0-9_.-]+$/).withMessage('SKU contains invalid characters.'),
  body('name').customSanitizer(cleanText).isLength({ min: 1, max: 120 }).withMessage('Name must be 1 to 120 characters.'),
  body('quantity').toInt().isInt({ min: 0, max: 1000000 }).withMessage('Quantity must be a non-negative integer.'),
  validated,
  (req, res, next) => {
    try {
      if (req.formErrors) {
        const items = db.prepare('SELECT id, sku, name, quantity FROM items ORDER BY name').all();
        const orders = db.prepare(`
          SELECT orders.id, orders.created_at, users.username, items.sku, items.name, order_lines.quantity
          FROM orders
          JOIN users ON users.id = orders.created_by
          JOIN order_lines ON order_lines.order_id = orders.id
          JOIN items ON items.id = order_lines.item_id
          ORDER BY orders.created_at DESC
          LIMIT 50
        `).all();
        return res.status(400).render('dashboard', { title: 'Warehouse', items, orders, errors: req.formErrors });
      }
      db.prepare('INSERT INTO items (sku, name, quantity) VALUES (?, ?, ?)').run(req.body.sku, req.body.name, req.body.quantity);
      flash(req, 'success', 'Item added.');
      return res.redirect('/dashboard');
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        flash(req, 'error', 'SKU is already in use.');
        return res.redirect('/dashboard');
      }
      return next(error);
    }
  }
);

app.post('/items/:id',
  requireAuth,
  requireRole('manager'),
  param('id').toInt().isInt({ min: 1 }).withMessage('Invalid item.'),
  body('quantity').toInt().isInt({ min: 0, max: 1000000 }).withMessage('Quantity must be a non-negative integer.'),
  validated,
  (req, res, next) => {
    try {
      if (req.formErrors) {
        flash(req, 'error', 'Invalid item update.');
        return res.redirect('/dashboard');
      }
      const result = db.prepare('UPDATE items SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.body.quantity, req.params.id);
      flash(req, result.changes ? 'success' : 'error', result.changes ? 'Stock updated.' : 'Item not found.');
      return res.redirect('/dashboard');
    } catch (error) {
      return next(error);
    }
  }
);

app.post('/orders',
  requireAuth,
  body('itemId').toInt().isInt({ min: 1 }).withMessage('Choose a valid item.'),
  body('quantity').toInt().isInt({ min: 1, max: 1000000 }).withMessage('Quantity must be a positive integer.'),
  validated,
  (req, res, next) => {
    try {
      if (req.formErrors) {
        flash(req, 'error', 'Invalid order request.');
        return res.redirect('/dashboard');
      }
      createOrder({ userId: req.session.user.id, itemId: req.body.itemId, quantity: req.body.quantity });
      flash(req, 'success', 'Order fulfilled and stock decremented.');
      return res.redirect('/dashboard');
    } catch (error) {
      if (error.code === 'INSUFFICIENT_STOCK') {
        flash(req, 'error', 'Insufficient stock to fulfill that order.');
        return res.redirect('/dashboard');
      }
      if (error.code === 'ITEM_NOT_FOUND') {
        flash(req, 'error', 'Item not found.');
        return res.redirect('/dashboard');
      }
      return next(error);
    }
  }
);

app.get('/orders/:id',
  requireAuth,
  param('id').toInt().isInt({ min: 1 }),
  validated,
  (req, res, next) => {
    try {
      if (req.formErrors) return res.status(404).render('error', { title: 'Not found', message: 'Order not found.' });
      const order = req.session.user.role === 'manager'
        ? db.prepare(`
            SELECT orders.id, orders.created_at, users.username, items.sku, items.name, order_lines.quantity
            FROM orders
            JOIN users ON users.id = orders.created_by
            JOIN order_lines ON order_lines.order_id = orders.id
            JOIN items ON items.id = order_lines.item_id
            WHERE orders.id = ?
          `).get(req.params.id)
        : db.prepare(`
            SELECT orders.id, orders.created_at, users.username, items.sku, items.name, order_lines.quantity
            FROM orders
            JOIN users ON users.id = orders.created_by
            JOIN order_lines ON order_lines.order_id = orders.id
            JOIN items ON items.id = order_lines.item_id
            WHERE orders.id = ? AND orders.created_by = ?
          `).get(req.params.id, req.session.user.id);
      if (!order) return res.status(404).render('error', { title: 'Not found', message: 'Order not found.' });
      return res.render('order', { title: `Order ${order.id}`, order });
    } catch (error) {
      return next(error);
    }
  }
);

app.use((req, res) => {
  res.status(404).render('error', { title: 'Not found', message: 'Page not found.' });
});

app.use((error, req, res, next) => {
  res.locals.currentUser = res.locals.currentUser || null;
  res.locals.csrfToken = res.locals.csrfToken || '';
  res.locals.flash = null;
  if (error.code === 'EBADCSRFTOKEN') {
    res.locals.currentUser = null;
    return res.status(403).render('error', { title: 'Forbidden', message: 'Invalid or expired form token.' });
  }
  console.error(error);
  return res.status(500).render('error', { title: 'Server error', message: 'Something went wrong. Please try again later.' });
});

app.listen(port, () => {
  console.log(`Warehouse app listening on port ${port}`);
});
