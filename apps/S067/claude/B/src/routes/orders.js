'use strict';

const express = require('express');
const { param, validationResult } = require('express-validator');

const { db } = require('../../db');
const { requireAuth } = require('../middleware/auth');
const { buildCartView, getCart } = require('./cart');

const router = express.Router();

router.use(requireAuth);

/** Place an order from the current cart. Total is computed on the server. */
router.post('/orders', (req, res, next) => {
  const userId = req.session.user.id;
  const { lines, totalCents } = buildCartView(getCart(req));

  if (lines.length === 0) {
    return res.redirect('/cart');
  }

  try {
    const placeOrder = db.transaction(() => {
      const orderInfo = db
        .prepare(
          "INSERT INTO orders (user_id, status, total_cents) VALUES (?, 'pending', ?)"
        )
        .run(userId, totalCents);
      const orderId = orderInfo.lastInsertRowid;

      const insertLine = db.prepare(
        `INSERT INTO order_items (order_id, menu_item_id, name, unit_price_cents, quantity)
         VALUES (?, ?, ?, ?, ?)`
      );
      for (const line of lines) {
        insertLine.run(orderId, line.id, line.name, line.unitPriceCents, line.quantity);
      }
      return orderId;
    });

    const orderId = placeOrder();
    req.session.cart = {}; // clear cart
    return res.redirect(`/orders/${orderId}`);
  } catch (err) {
    return next(err);
  }
});

/** A customer's own order history. */
router.get('/orders', (req, res) => {
  const orders = db
    .prepare(
      'SELECT id, status, total_cents, created_at FROM orders WHERE user_id = ? ORDER BY created_at DESC'
    )
    .all(req.session.user.id);
  res.render('orders', { title: 'My orders', orders });
});

/** A single order — ownership enforced to prevent IDOR. */
router.get('/orders/:id', [param('id').isInt({ min: 1 }).toInt()], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(404).render('error', { title: 'Not found', status: 404, message: 'Order not found.' });
  }

  const order = db
    .prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.session.user.id);

  if (!order) {
    // Do not reveal whether the order exists for another user.
    return res.status(404).render('error', { title: 'Not found', status: 404, message: 'Order not found.' });
  }

  const items = db
    .prepare('SELECT name, unit_price_cents, quantity FROM order_items WHERE order_id = ?')
    .all(order.id);

  res.render('order_detail', { title: `Order #${order.id}`, order, items });
});

module.exports = router;
