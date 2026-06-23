'use strict';

const express = require('express');
const db = require('../db/connection');
const { requireLogin, requireRole } = require('../middleware/auth');

const router = express.Router();

const listProducts = db.prepare('SELECT * FROM products ORDER BY name');
const getProduct = db.prepare('SELECT * FROM products WHERE id = ?');
const insertProduct = db.prepare(
  'INSERT INTO products (sku, name, quantity) VALUES (?, ?, ?)'
);
const updateQuantity = db.prepare('UPDATE products SET quantity = ? WHERE id = ?');

// Anyone logged in can view stock.
router.get('/', requireLogin, (req, res) => {
  res.render('products', {
    title: 'Stock levels',
    products: listProducts.all(),
  });
});

// Only managers can add products or change stock levels.
router.get('/new', requireRole('manager'), (req, res) => {
  res.render('product_new', { title: 'Add product' });
});

router.post('/', requireRole('manager'), (req, res) => {
  const sku = (req.body.sku || '').trim();
  const name = (req.body.name || '').trim();
  const quantity = parseInt(req.body.quantity, 10);

  if (!sku || !name || !Number.isInteger(quantity) || quantity < 0) {
    req.flash('error', 'SKU, name and a non-negative quantity are required.');
    return res.redirect('/products/new');
  }

  try {
    insertProduct.run(sku, name, quantity);
    req.flash('success', `Product "${name}" added.`);
    res.redirect('/products');
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      req.flash('error', `A product with SKU "${sku}" already exists.`);
      return res.redirect('/products/new');
    }
    throw err;
  }
});

// Adjust stock level (set, add, or remove). Managers only.
router.post('/:id/adjust', requireRole('manager'), (req, res) => {
  const product = getProduct.get(req.params.id);
  if (!product) {
    req.flash('error', 'Product not found.');
    return res.redirect('/products');
  }

  const mode = req.body.mode; // 'set' | 'add' | 'remove'
  const amount = parseInt(req.body.amount, 10);

  if (!Number.isInteger(amount) || amount < 0) {
    req.flash('error', 'Amount must be a non-negative whole number.');
    return res.redirect('/products');
  }

  let newQty;
  if (mode === 'add') newQty = product.quantity + amount;
  else if (mode === 'remove') newQty = product.quantity - amount;
  else newQty = amount; // 'set'

  if (newQty < 0) {
    req.flash('error', `Cannot reduce "${product.name}" below zero.`);
    return res.redirect('/products');
  }

  updateQuantity.run(newQty, product.id);
  req.flash('success', `Stock for "${product.name}" updated to ${newQty}.`);
  res.redirect('/products');
});

module.exports = router;
