'use strict';

const express = require('express');
const { body, param, validationResult } = require('express-validator');

const { db } = require('../../db');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

const STATUSES = ['pending', 'preparing', 'ready', 'completed', 'cancelled'];

// Every /staff route requires the "staff" role.
router.use(requireRole('staff'));

/** Incoming orders queue, newest first, optionally filtered by status. */
router.get('/orders', (req, res) => {
  const filter = STATUSES.includes(req.query.status) ? req.query.status : null;

  const orders = filter
    ? db
        .prepare(
          `SELECT o.id, o.status, o.total_cents, o.created_at, u.username
           FROM orders o JOIN users u ON u.id = o.user_id
           WHERE o.status = ? ORDER BY o.created_at DESC`
        )
        .all(filter)
    : db
        .prepare(
          `SELECT o.id, o.status, o.total_cents, o.created_at, u.username
           FROM orders o JOIN users u ON u.id = o.user_id
           ORDER BY o.created_at DESC`
        )
        .all();

  res.render('staff_orders', { title: 'Incoming orders', orders, statuses: STATUSES, filter });
});

/** Staff view of any order's details. */
router.get('/orders/:id', [param('id').isInt({ min: 1 }).toInt()], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(404).render('error', { title: 'Not found', status: 404, message: 'Order not found.' });
  }

  const order = db
    .prepare(
      `SELECT o.*, u.username FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = ?`
    )
    .get(req.params.id);

  if (!order) {
    return res.status(404).render('error', { title: 'Not found', status: 404, message: 'Order not found.' });
  }

  const items = db
    .prepare('SELECT name, unit_price_cents, quantity FROM order_items WHERE order_id = ?')
    .all(order.id);

  res.render('staff_order_detail', { title: `Order #${order.id}`, order, items, statuses: STATUSES });
});

/** Update an order's status (state-changing → CSRF-protected, validated). */
router.post(
  '/orders/:id/status',
  [
    param('id').isInt({ min: 1 }).toInt(),
    body('status').isIn(STATUSES).withMessage('Invalid status.')
  ],
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).render('error', {
        title: 'Invalid request',
        status: 400,
        message: errors.array()[0].msg
      });
    }

    try {
      const result = db
        .prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?")
        .run(req.body.status, req.params.id);

      if (result.changes === 0) {
        return res.status(404).render('error', { title: 'Not found', status: 404, message: 'Order not found.' });
      }
      return res.redirect(`/staff/orders/${req.params.id}`);
    } catch (err) {
      return next(err);
    }
  }
);

module.exports = router;
