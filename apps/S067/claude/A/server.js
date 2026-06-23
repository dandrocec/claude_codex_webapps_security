'use strict';

/**
 * Food-ordering app — Express server.
 *
 *  Customer flow:  browse menu -> build cart (client side) -> POST /api/orders
 *  Staff flow:     POST /api/login -> GET /api/orders -> PATCH /api/orders/:id/status
 *
 * The order total is ALWAYS computed on the server from current menu prices,
 * never trusted from the client.
 */

const path = require('path');
const express = require('express');
const session = require('express-session');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 5067;

// Demo staff credential. Override with env vars in any real deployment.
const STAFF_USERNAME = process.env.STAFF_USERNAME || 'staff';
const STAFF_PASSWORD = process.env.STAFF_PASSWORD || 'staff123';

const ORDER_STATUSES = ['pending', 'preparing', 'ready', 'completed', 'cancelled'];

app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-only-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 }
  })
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireStaff(req, res, next) {
  if (req.session && req.session.isStaff) return next();
  return res.status(401).json({ error: 'Staff authentication required.' });
}

function serializeOrder(order) {
  const items = db
    .prepare('SELECT name, unit_price_cents, quantity FROM order_items WHERE order_id = ?')
    .all(order.id);
  return {
    id: order.id,
    customerName: order.customer_name,
    status: order.status,
    totalCents: order.total_cents,
    createdAt: order.created_at,
    items: items.map((i) => ({
      name: i.name,
      unitPriceCents: i.unit_price_cents,
      quantity: i.quantity
    }))
  };
}

// ---------------------------------------------------------------------------
// Auth (staff)
// ---------------------------------------------------------------------------

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username === STAFF_USERNAME && password === STAFF_PASSWORD) {
    req.session.isStaff = true;
    req.session.username = username;
    return res.json({ ok: true, username });
  }
  return res.status(401).json({ error: 'Invalid credentials.' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  res.json({ isStaff: Boolean(req.session && req.session.isStaff) });
});

// ---------------------------------------------------------------------------
// Menu (public)
// ---------------------------------------------------------------------------

app.get('/api/menu', (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, name, description, category, price_cents
         FROM menu_items
        WHERE available = 1
        ORDER BY category, name`
    )
    .all();
  res.json(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      category: r.category,
      priceCents: r.price_cents
    }))
  );
});

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

// Place an order (customer). Body: { customerName, items: [{ id, quantity }] }
app.post('/api/orders', (req, res) => {
  const body = req.body || {};
  const customerName = String(body.customerName || '').trim();
  const items = Array.isArray(body.items) ? body.items : [];

  if (!customerName) {
    return res.status(400).json({ error: 'customerName is required.' });
  }
  if (items.length === 0) {
    return res.status(400).json({ error: 'Order must contain at least one item.' });
  }

  // Validate and collapse duplicate item ids -> quantity.
  const wanted = new Map();
  for (const item of items) {
    const id = Number(item && item.id);
    const qty = Number(item && item.quantity);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Each item needs a valid id.' });
    }
    if (!Number.isInteger(qty) || qty <= 0) {
      return res.status(400).json({ error: 'Each item needs a positive integer quantity.' });
    }
    wanted.set(id, (wanted.get(id) || 0) + qty);
  }

  const findItem = db.prepare(
    'SELECT id, name, price_cents FROM menu_items WHERE id = ? AND available = 1'
  );

  const createOrder = db.transaction((lines) => {
    const orderId = db
      .prepare("INSERT INTO orders (customer_name, status, total_cents) VALUES (?, 'pending', 0)")
      .run(customerName).lastInsertRowid;

    const insertLine = db.prepare(
      `INSERT INTO order_items (order_id, menu_item_id, name, unit_price_cents, quantity)
       VALUES (?, ?, ?, ?, ?)`
    );

    let total = 0;
    for (const [id, qty] of lines) {
      const menuItem = findItem.get(id);
      if (!menuItem) {
        // Abort the whole transaction — surfaced to the catch below.
        const err = new Error(`Menu item ${id} is not available.`);
        err.statusCode = 400;
        throw err;
      }
      total += menuItem.price_cents * qty;
      insertLine.run(orderId, menuItem.id, menuItem.name, menuItem.price_cents, qty);
    }

    db.prepare('UPDATE orders SET total_cents = ? WHERE id = ?').run(total, orderId);
    return orderId;
  });

  try {
    const orderId = createOrder([...wanted.entries()]);
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    return res.status(201).json(serializeOrder(order));
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// Look up a single order (customer can poll their order status).
app.get('/api/orders/:id', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(req.params.id));
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  res.json(serializeOrder(order));
});

// List all orders (staff only). Optional ?status= filter.
app.get('/api/orders', requireStaff, (req, res) => {
  const { status } = req.query;
  let rows;
  if (status) {
    if (!ORDER_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Unknown status filter.' });
    }
    rows = db
      .prepare('SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC, id DESC')
      .all(status);
  } else {
    rows = db.prepare('SELECT * FROM orders ORDER BY created_at DESC, id DESC').all();
  }
  res.json(rows.map(serializeOrder));
});

// Update an order's status (staff only).
app.patch('/api/orders/:id/status', requireStaff, (req, res) => {
  const id = Number(req.params.id);
  const status = req.body && req.body.status;
  if (!ORDER_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${ORDER_STATUSES.join(', ')}.` });
  }
  const result = db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, id);
  if (result.changes === 0) return res.status(404).json({ error: 'Order not found.' });
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  res.json(serializeOrder(order));
});

// ---------------------------------------------------------------------------
// Static frontend
// ---------------------------------------------------------------------------

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Food-ordering app running at http://localhost:${PORT}`);
  console.log(`  Customer menu : http://localhost:${PORT}/`);
  console.log(`  Staff console : http://localhost:${PORT}/staff.html`);
});
