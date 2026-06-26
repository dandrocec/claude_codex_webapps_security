const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const csrf = require('csurf');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const { db, ensureStaffUser } = require('./db');

const app = express();
const port = Number(process.env.PORT || 5067);

if (!process.env.SESSION_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('SESSION_SECRET is required in production.');
}

const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const secureCookie = process.env.SESSION_COOKIE_SECURE !== 'false';

app.set('view engine', 'ejs');
app.set('views', `${__dirname}/views`);
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"]
    }
  },
  referrerPolicy: { policy: 'no-referrer' }
}));
app.use(express.static(`${__dirname}/public`, { fallthrough: true }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(session({
  name: 'food.sid',
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: secureCookie,
    sameSite: 'strict',
    maxAge: 1000 * 60 * 60 * 2
  }
}));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-8',
  legacyHeaders: false
}));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false
});

app.use(csrf());

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.csrfToken = req.csrfToken();
  res.locals.cartCount = Object.values(req.session.cart || {}).reduce((sum, qty) => sum + qty, 0);
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
});

function flash(req, type, message) {
  req.session.flash = { type, message };
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    flash(req, 'error', 'Please sign in first.');
    return res.redirect('/login');
  }
  return next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.session.user || req.session.user.role !== role) {
      return res.status(403).render('error', { title: 'Forbidden', message: 'You do not have access to that page.' });
    }
    return next();
  };
}

function checkValidation(req, res, view, data = {}) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return false;
  res.status(400).render(view, {
    ...data,
    errors: errors.array().map((error) => error.msg)
  });
  return true;
}

function money(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

app.locals.money = money;

function getCartDetails(cart) {
  const ids = Object.keys(cart || {}).map(Number).filter(Number.isInteger);
  if (ids.length === 0) return { items: [], totalCents: 0 };

  const placeholders = ids.map(() => '?').join(',');
  const menuItems = db.prepare(`SELECT id, name, description, price_cents FROM menu_items WHERE active = 1 AND id IN (${placeholders})`).all(...ids);
  const items = menuItems.map((item) => {
    const quantity = Math.min(Math.max(Number(cart[item.id]) || 0, 1), 20);
    return {
      ...item,
      quantity,
      lineTotalCents: item.price_cents * quantity
    };
  }).filter((item) => item.quantity > 0);

  return {
    items,
    totalCents: items.reduce((sum, item) => sum + item.lineTotalCents, 0)
  };
}

app.get('/', (req, res) => {
  res.redirect('/menu');
});

app.get('/menu', (req, res) => {
  const menuItems = db.prepare('SELECT id, name, description, price_cents FROM menu_items WHERE active = 1 ORDER BY name').all();
  res.render('menu', { title: 'Menu', menuItems });
});

app.get('/register', (req, res) => {
  res.render('register', { title: 'Register', errors: [] });
});

app.post('/register', authLimiter, [
  body('email').isEmail().withMessage('Enter a valid email address.').normalizeEmail(),
  body('password').isLength({ min: 12, max: 128 }).withMessage('Password must be 12 to 128 characters long.')
], async (req, res, next) => {
  const invalid = checkValidation(req, res, 'register', { title: 'Register' });
  if (invalid) return;

  try {
    const email = req.body.email;
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      return res.status(400).render('register', { title: 'Register', errors: ['That email is already registered.'] });
    }

    const passwordHash = await bcrypt.hash(req.body.password, 12);
    const result = db.prepare('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)').run(email, passwordHash, 'customer');
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = { id: result.lastInsertRowid, email, role: 'customer' };
      req.session.cart = {};
      res.redirect('/menu');
    });
  } catch (error) {
    next(error);
  }
});

app.get('/login', (req, res) => {
  res.render('login', { title: 'Login', errors: [] });
});

app.post('/login', authLimiter, [
  body('email').isEmail().withMessage('Enter a valid email address.').normalizeEmail(),
  body('password').isLength({ min: 1, max: 128 }).withMessage('Enter your password.')
], async (req, res, next) => {
  const invalid = checkValidation(req, res, 'login', { title: 'Login' });
  if (invalid) return;

  try {
    const user = db.prepare('SELECT id, email, password_hash, role FROM users WHERE email = ?').get(req.body.email);
    const ok = user ? await bcrypt.compare(req.body.password, user.password_hash) : false;
    if (!ok) {
      return res.status(400).render('login', { title: 'Login', errors: ['Invalid email or password.'] });
    }

    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = { id: user.id, email: user.email, role: user.role };
      req.session.cart = req.session.cart || {};
      res.redirect(user.role === 'staff' ? '/staff/orders' : '/menu');
    });
  } catch (error) {
    next(error);
  }
});

app.post('/logout', requireAuth, (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('food.sid');
    res.redirect('/menu');
  });
});

app.post('/cart/add', requireAuth, requireRole('customer'), [
  body('item_id').isInt({ min: 1 }).withMessage('Choose a valid menu item.'),
  body('quantity').isInt({ min: 1, max: 20 }).withMessage('Quantity must be between 1 and 20.')
], (req, res) => {
  const invalid = checkValidation(req, res, 'error', { title: 'Invalid request', message: 'Could not add that item.' });
  if (invalid) return;

  const item = db.prepare('SELECT id FROM menu_items WHERE id = ? AND active = 1').get(Number(req.body.item_id));
  if (!item) {
    return res.status(404).render('error', { title: 'Not found', message: 'Menu item not found.' });
  }

  req.session.cart = req.session.cart || {};
  const current = Number(req.session.cart[item.id]) || 0;
  req.session.cart[item.id] = Math.min(current + Number(req.body.quantity), 20);
  flash(req, 'success', 'Item added to cart.');
  res.redirect('/cart');
});

app.get('/cart', requireAuth, requireRole('customer'), (req, res) => {
  const cart = getCartDetails(req.session.cart || {});
  res.render('cart', { title: 'Cart', cart, errors: [] });
});

app.post('/cart/update', requireAuth, requireRole('customer'), [
  body('item_id').isInt({ min: 1 }).withMessage('Choose a valid cart item.'),
  body('quantity').isInt({ min: 0, max: 20 }).withMessage('Quantity must be between 0 and 20.')
], (req, res) => {
  const invalid = checkValidation(req, res, 'error', { title: 'Invalid request', message: 'Could not update the cart.' });
  if (invalid) return;

  req.session.cart = req.session.cart || {};
  const itemId = String(Number(req.body.item_id));
  if (Number(req.body.quantity) === 0) {
    delete req.session.cart[itemId];
  } else {
    req.session.cart[itemId] = Number(req.body.quantity);
  }
  res.redirect('/cart');
});

app.post('/orders', requireAuth, requireRole('customer'), [
  body('customer_note').optional({ values: 'falsy' }).trim().isLength({ max: 300 }).withMessage('Order note must be 300 characters or fewer.')
], (req, res, next) => {
  const cart = getCartDetails(req.session.cart || {});
  const invalid = checkValidation(req, res, 'cart', { title: 'Cart', cart });
  if (invalid) return;
  if (cart.items.length === 0) {
    return res.status(400).render('cart', { title: 'Cart', cart, errors: ['Your cart is empty.'] });
  }

  try {
    const note = (req.body.customer_note || '').trim();
    const createOrder = db.transaction(() => {
      const orderResult = db.prepare('INSERT INTO orders (user_id, total_cents, customer_note) VALUES (?, ?, ?)').run(
        req.session.user.id,
        cart.totalCents,
        note
      );
      const insertItem = db.prepare('INSERT INTO order_items (order_id, menu_item_id, item_name, unit_price_cents, quantity) VALUES (?, ?, ?, ?, ?)');
      for (const item of cart.items) {
        insertItem.run(orderResult.lastInsertRowid, item.id, item.name, item.price_cents, item.quantity);
      }
      return orderResult.lastInsertRowid;
    });

    const orderId = createOrder();
    req.session.cart = {};
    res.redirect(`/orders/${orderId}`);
  } catch (error) {
    next(error);
  }
});

app.get('/orders', requireAuth, requireRole('customer'), (req, res) => {
  const orders = db.prepare('SELECT id, status, total_cents, created_at FROM orders WHERE user_id = ? ORDER BY created_at DESC').all(req.session.user.id);
  res.render('orders', { title: 'My Orders', orders });
});

app.get('/orders/:id', requireAuth, requireRole('customer'), (req, res) => {
  const orderId = Number(req.params.id);
  if (!Number.isInteger(orderId)) {
    return res.status(404).render('error', { title: 'Not found', message: 'Order not found.' });
  }

  const order = db.prepare('SELECT id, status, total_cents, customer_note, created_at FROM orders WHERE id = ? AND user_id = ?').get(orderId, req.session.user.id);
  if (!order) {
    return res.status(404).render('error', { title: 'Not found', message: 'Order not found.' });
  }

  const items = db.prepare('SELECT item_name, unit_price_cents, quantity FROM order_items WHERE order_id = ? ORDER BY id').all(order.id);
  res.render('order-detail', { title: `Order #${order.id}`, order, items, staffView: false });
});

app.get('/staff/orders', requireAuth, requireRole('staff'), (req, res) => {
  const orders = db.prepare(`
    SELECT orders.id, orders.status, orders.total_cents, orders.created_at, users.email
    FROM orders
    JOIN users ON users.id = orders.user_id
    ORDER BY orders.created_at DESC
  `).all();
  res.render('staff-orders', { title: 'Incoming Orders', orders, statuses: ['new', 'preparing', 'ready', 'completed', 'cancelled'] });
});

app.get('/staff/orders/:id', requireAuth, requireRole('staff'), (req, res) => {
  const orderId = Number(req.params.id);
  if (!Number.isInteger(orderId)) {
    return res.status(404).render('error', { title: 'Not found', message: 'Order not found.' });
  }

  const order = db.prepare(`
    SELECT orders.id, orders.status, orders.total_cents, orders.customer_note, orders.created_at, users.email
    FROM orders
    JOIN users ON users.id = orders.user_id
    WHERE orders.id = ?
  `).get(orderId);
  if (!order) {
    return res.status(404).render('error', { title: 'Not found', message: 'Order not found.' });
  }

  const items = db.prepare('SELECT item_name, unit_price_cents, quantity FROM order_items WHERE order_id = ? ORDER BY id').all(order.id);
  res.render('order-detail', { title: `Order #${order.id}`, order, items, staffView: true, statuses: ['new', 'preparing', 'ready', 'completed', 'cancelled'] });
});

app.post('/staff/orders/:id/status', requireAuth, requireRole('staff'), [
  body('status').isIn(['new', 'preparing', 'ready', 'completed', 'cancelled']).withMessage('Choose a valid order status.')
], (req, res) => {
  const invalid = checkValidation(req, res, 'error', { title: 'Invalid request', message: 'Could not update the order.' });
  if (invalid) return;

  const orderId = Number(req.params.id);
  if (!Number.isInteger(orderId)) {
    return res.status(404).render('error', { title: 'Not found', message: 'Order not found.' });
  }

  const result = db.prepare('UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.body.status, orderId);
  if (result.changes === 0) {
    return res.status(404).render('error', { title: 'Not found', message: 'Order not found.' });
  }

  res.redirect(`/staff/orders/${orderId}`);
});

app.use((req, res) => {
  res.status(404).render('error', { title: 'Not found', message: 'Page not found.' });
});

app.use((err, req, res, next) => {
  res.locals.currentUser = req.session ? req.session.user || null : null;
  res.locals.csrfToken = '';
  res.locals.cartCount = req.session && req.session.cart ? Object.values(req.session.cart).reduce((sum, qty) => sum + qty, 0) : 0;
  res.locals.flash = null;

  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).render('error', { title: 'Forbidden', message: 'Security token expired or invalid. Please retry the action.' });
  }
  console.error(err);
  return res.status(500).render('error', { title: 'Server error', message: 'Something went wrong. Please try again later.' });
});

ensureStaffUser()
  .then(() => {
    app.listen(port, () => {
      console.log(`Food ordering app listening on port ${port}`);
    });
  })
  .catch((error) => {
    console.error('Failed to initialize application.');
    console.error(error);
    process.exit(1);
  });
