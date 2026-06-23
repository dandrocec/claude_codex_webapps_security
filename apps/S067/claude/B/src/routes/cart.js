'use strict';

const express = require('express');
const { body, param, validationResult } = require('express-validator');

const { db } = require('../../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

/** The cart lives in the session as { [menuItemId]: quantity }. */
function getCart(req) {
  if (!req.session.cart) req.session.cart = {};
  return req.session.cart;
}

/**
 * Build a detailed view of the cart, recomputing prices from the database
 * (never trusting any client-supplied price) and computing the total server-side.
 */
function buildCartView(cart) {
  const ids = Object.keys(cart);
  const lines = [];
  let totalCents = 0;

  for (const id of ids) {
    const item = db
      .prepare('SELECT id, name, price_cents, available FROM menu_items WHERE id = ?')
      .get(Number(id));
    if (!item || !item.available) continue; // drop items that vanished/disabled

    const quantity = cart[id];
    const lineCents = item.price_cents * quantity;
    totalCents += lineCents;
    lines.push({
      id: item.id,
      name: item.name,
      unitPriceCents: item.price_cents,
      quantity,
      lineCents
    });
  }

  return { lines, totalCents };
}

router.use(requireAuth);

router.get('/cart', (req, res) => {
  const view = buildCartView(getCart(req));
  res.render('cart', { title: 'Your cart', ...view });
});

router.post(
  '/cart/add',
  [
    body('menuItemId').isInt({ min: 1 }).toInt(),
    body('quantity').optional().isInt({ min: 1, max: 50 }).toInt()
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.redirect('/menu');

    const { menuItemId } = req.body;
    const quantity = req.body.quantity || 1;

    const item = db
      .prepare('SELECT id FROM menu_items WHERE id = ? AND available = 1')
      .get(menuItemId);
    if (!item) return res.redirect('/menu');

    const cart = getCart(req);
    cart[menuItemId] = Math.min((cart[menuItemId] || 0) + quantity, 50);
    res.redirect('/cart');
  }
);

router.post(
  '/cart/update/:menuItemId',
  [param('menuItemId').isInt({ min: 1 }).toInt(), body('quantity').isInt({ min: 0, max: 50 }).toInt()],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.redirect('/cart');

    const cart = getCart(req);
    const id = String(req.params.menuItemId);
    if (req.body.quantity === 0) {
      delete cart[id];
    } else {
      cart[id] = req.body.quantity;
    }
    res.redirect('/cart');
  }
);

router.post('/cart/remove/:menuItemId', [param('menuItemId').isInt({ min: 1 }).toInt()], (req, res) => {
  const cart = getCart(req);
  delete cart[String(req.params.menuItemId)];
  res.redirect('/cart');
});

module.exports = { router, buildCartView, getCart };
