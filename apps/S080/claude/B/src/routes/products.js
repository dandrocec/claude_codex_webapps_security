'use strict';

const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { Products } = require('../models');
const { requireAuth, requireRole } = require('../middleware/auth');
const { AppError } = require('../errors');

const router = express.Router();

// Anyone authenticated may view stock levels.
router.get('/', requireAuth, (req, res) => {
  res.render('products/list', {
    title: 'Stock',
    products: Products.all(),
  });
});

// Only managers manage stock.
router.get('/new', requireRole('manager'), (req, res) => {
  res.render('products/new', { title: 'Add product', errors: [], values: {} });
});

router.post(
  '/',
  requireRole('manager'),
  body('sku').trim().isLength({ min: 1, max: 32 }).matches(/^[A-Za-z0-9_-]+$/)
    .withMessage('SKU may contain letters, numbers, hyphen and underscore only.'),
  body('name').trim().isLength({ min: 1, max: 120 }),
  body('stock').isInt({ min: 0, max: 1_000_000 }).withMessage('Stock must be a whole number ≥ 0.'),
  (req, res) => {
    const errors = validationResult(req);
    const values = {
      sku: (req.body.sku || '').trim(),
      name: (req.body.name || '').trim(),
      stock: req.body.stock,
    };
    if (!errors.isEmpty()) {
      return res.status(400).render('products/new', {
        title: 'Add product',
        errors: errors.array(),
        values,
      });
    }
    if (Products.findBySku(values.sku)) {
      return res.status(409).render('products/new', {
        title: 'Add product',
        errors: [{ msg: 'A product with that SKU already exists.' }],
        values,
      });
    }
    Products.create({
      sku: values.sku,
      name: values.name,
      stock: parseInt(values.stock, 10),
    });
    return res.redirect('/products');
  }
);

router.get(
  '/:id/edit',
  requireRole('manager'),
  param('id').isInt({ min: 1 }),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new AppError('Invalid product id.', 400));
    }
    const product = Products.findById(parseInt(req.params.id, 10));
    if (!product) {
      return next(new AppError('Product not found.', 404));
    }
    return res.render('products/edit', { title: 'Adjust stock', product, errors: [] });
  }
);

router.post(
  '/:id/stock',
  requireRole('manager'),
  param('id').isInt({ min: 1 }),
  body('stock').isInt({ min: 0, max: 1_000_000 }).withMessage('Stock must be a whole number ≥ 0.'),
  (req, res, next) => {
    const errors = validationResult(req);
    const id = parseInt(req.params.id, 10);
    const product = Products.findById(id);
    if (!product) {
      return next(new AppError('Product not found.', 404));
    }
    if (!errors.isEmpty()) {
      return res.status(400).render('products/edit', {
        title: 'Adjust stock',
        product,
        errors: errors.array(),
      });
    }
    Products.setStock(id, parseInt(req.body.stock, 10));
    return res.redirect('/products');
  }
);

module.exports = router;
