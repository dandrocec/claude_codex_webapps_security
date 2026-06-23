'use strict';

const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { Orders, Products } = require('../models');
const { requireAuth } = require('../middleware/auth');
const { AppError } = require('../errors');

const router = express.Router();

const isManager = (req) => req.session.role === 'manager';

// Managers see all orders; clerks see only their own (access control).
router.get('/', requireAuth, (req, res) => {
  const orders = isManager(req)
    ? Orders.list()
    : Orders.list({ userId: req.session.userId });
  res.render('orders/list', { title: 'Orders', orders });
});

// New-order form (clerks and managers may create orders).
router.get('/new', requireAuth, (req, res) => {
  res.render('orders/new', {
    title: 'New order',
    products: Products.all(),
    errors: [],
    values: {},
  });
});

router.post(
  '/',
  requireAuth,
  body('product_id').isInt({ min: 1 }).withMessage('Please choose a product.'),
  body('quantity').isInt({ min: 1, max: 1_000_000 }).withMessage('Quantity must be a whole number ≥ 1.'),
  (req, res, next) => {
    const errors = validationResult(req);
    const values = { product_id: req.body.product_id, quantity: req.body.quantity };
    if (!errors.isEmpty()) {
      return res.status(400).render('orders/new', {
        title: 'New order',
        products: Products.all(),
        errors: errors.array(),
        values,
      });
    }
    try {
      const orderId = Orders.create({
        productId: parseInt(req.body.product_id, 10),
        quantity: parseInt(req.body.quantity, 10),
        userId: req.session.userId,
      });
      return res.redirect(`/orders/${orderId}`);
    } catch (err) {
      if (err instanceof AppError) {
        return res.status(err.statusCode).render('orders/new', {
          title: 'New order',
          products: Products.all(),
          errors: [{ msg: err.message }],
          values,
        });
      }
      return next(err);
    }
  }
);

// View a single order. Clerks may only view their own (prevents IDOR).
router.get(
  '/:id',
  requireAuth,
  param('id').isInt({ min: 1 }),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new AppError('Invalid order id.', 400));
    }
    const order = Orders.findById(parseInt(req.params.id, 10));
    if (!order) {
      return next(new AppError('Order not found.', 404));
    }
    if (!isManager(req) && order.created_by !== req.session.userId) {
      // Treat as not-found to avoid leaking existence of others' orders.
      return next(new AppError('Order not found.', 404));
    }
    return res.render('orders/show', { title: `Order #${order.id}`, order });
  }
);

// Cancel an order (restores stock). Clerks may only cancel their own.
router.post(
  '/:id/cancel',
  requireAuth,
  param('id').isInt({ min: 1 }),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new AppError('Invalid order id.', 400));
    }
    const id = parseInt(req.params.id, 10);
    const order = Orders.findById(id);
    if (!order) {
      return next(new AppError('Order not found.', 404));
    }
    if (!isManager(req) && order.created_by !== req.session.userId) {
      return next(new AppError('Order not found.', 404));
    }
    try {
      Orders.cancel(id);
    } catch (err) {
      if (err instanceof AppError) {
        return next(err);
      }
      return next(err);
    }
    return res.redirect(`/orders/${id}`);
  }
);

module.exports = router;
