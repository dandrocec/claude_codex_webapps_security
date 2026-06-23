'use strict';

const express = require('express');
const db = require('../db/connection');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();

const listProducts = db.prepare('SELECT * FROM products ORDER BY name');
const getProduct = db.prepare('SELECT * FROM products WHERE id = ?');
const decrementStock = db.prepare(
  'UPDATE products SET quantity = quantity - ? WHERE id = ?'
);
const insertOrder = db.prepare(
  'INSERT INTO orders (customer, created_by) VALUES (?, ?)'
);
const insertItem = db.prepare(
  'INSERT INTO order_items (order_id, product_id, quantity, unit_name) VALUES (?, ?, ?, ?)'
);

const listOrders = db.prepare(`
  SELECT o.id, o.customer, o.status, o.created_at, u.username AS created_by
  FROM orders o
  JOIN users u ON u.id = o.created_by
  ORDER BY o.id DESC
`);
const getOrder = db.prepare(`
  SELECT o.id, o.customer, o.status, o.created_at, u.username AS created_by
  FROM orders o
  JOIN users u ON u.id = o.created_by
  WHERE o.id = ?
`);
const getOrderItems = db.prepare(`
  SELECT oi.quantity, oi.unit_name, p.sku
  FROM order_items oi
  JOIN products p ON p.id = oi.product_id
  WHERE oi.order_id = ?
`);

// List all orders. Both roles can see them.
router.get('/', requireLogin, (req, res) => {
  res.render('orders', { title: 'Orders', orders: listOrders.all() });
});

// New-order form. Clerks and managers can both process orders.
router.get('/new', requireLogin, (req, res) => {
  res.render('order_new', {
    title: 'Process order',
    products: listProducts.all(),
  });
});

router.get('/:id', requireLogin, (req, res) => {
  const order = getOrder.get(req.params.id);
  if (!order) {
    req.flash('error', 'Order not found.');
    return res.redirect('/orders');
  }
  res.render('order_show', {
    title: `Order #${order.id}`,
    order,
    items: getOrderItems.all(order.id),
  });
});

/**
 * Process an order. The request body carries `customer` and a `qty` map
 * of productId -> requested quantity. The whole operation runs inside a
 * single transaction: we re-check stock for every line and abort (rolling
 * back) if any product has insufficient stock. This guarantees an order is
 * never partially fulfilled and stock can never go negative.
 */
const processOrder = db.transaction((customer, userId, requested) => {
  const lines = [];

  for (const item of requested) {
    const product = getProduct.get(item.productId);
    if (!product) {
      throw new OrderError(`Product #${item.productId} no longer exists.`);
    }
    if (item.quantity > product.quantity) {
      throw new OrderError(
        `Insufficient stock for "${product.name}" (requested ${item.quantity}, available ${product.quantity}).`
      );
    }
    lines.push({ product, quantity: item.quantity });
  }

  const { lastInsertRowid: orderId } = insertOrder.run(customer, userId);

  for (const line of lines) {
    decrementStock.run(line.quantity, line.product.id);
    insertItem.run(orderId, line.product.id, line.quantity, line.product.name);
  }

  return orderId;
});

class OrderError extends Error {}

router.post('/', requireLogin, (req, res) => {
  const customer = (req.body.customer || '').trim();
  const qtyMap = req.body.qty || {};

  const requested = Object.keys(qtyMap)
    .map((productId) => ({
      productId: parseInt(productId, 10),
      quantity: parseInt(qtyMap[productId], 10),
    }))
    .filter((line) => Number.isInteger(line.quantity) && line.quantity > 0);

  if (!customer) {
    req.flash('error', 'A customer name is required.');
    return res.redirect('/orders/new');
  }
  if (requested.length === 0) {
    req.flash('error', 'Add a quantity for at least one product.');
    return res.redirect('/orders/new');
  }

  try {
    const orderId = processOrder(customer, req.session.user.id, requested);
    req.flash('success', `Order #${orderId} fulfilled and stock updated.`);
    res.redirect(`/orders/${orderId}`);
  } catch (err) {
    if (err instanceof OrderError) {
      req.flash('error', `Order rejected: ${err.message}`);
      return res.redirect('/orders/new');
    }
    throw err;
  }
});

module.exports = router;
