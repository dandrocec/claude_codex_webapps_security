'use strict';

const express = require('express');
const { body, param, validationResult } = require('express-validator');
const models = require('../models');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Convert a browser datetime-local value (local wall-clock, no zone) into a
// UTC string comparable with SQLite's datetime('now').
function toUtcSqlString(localValue) {
  const d = new Date(localValue);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function itemIsEnded(item) {
  // Compare against current UTC time.
  const nowUtc = new Date().toISOString().slice(0, 19).replace('T', ' ');
  return item.end_time <= nowUtc;
}

const idRule = param('id').isInt({ min: 1 }).toInt();

// ---- Listing -------------------------------------------------------------

router.get('/', (req, res) => {
  const items = models.listItems();
  res.render('index', { items });
});

// ---- Create --------------------------------------------------------------

router.get('/items/new', requireAuth, (req, res) => {
  res.render('new-item', { errors: [], values: {} });
});

router.post(
  '/items',
  requireAuth,
  body('title').trim().isLength({ min: 3, max: 120 }).withMessage('Title must be 3–120 characters.'),
  body('description').trim().isLength({ max: 2000 }).withMessage('Description is too long.'),
  body('starting_price')
    .isFloat({ min: 0, max: 1_000_000_000 })
    .withMessage('Starting price must be a non-negative number.'),
  body('end_time').notEmpty().withMessage('End time is required.'),
  (req, res, next) => {
    const result = validationResult(req);
    const values = {
      title: req.body.title || '',
      description: req.body.description || '',
      starting_price: req.body.starting_price || '',
      end_time: req.body.end_time || '',
    };
    const errors = result.array();

    const endTimeUtc = toUtcSqlString(req.body.end_time);
    if (req.body.end_time && !endTimeUtc) {
      errors.push({ msg: 'End time is not a valid date.' });
    } else if (endTimeUtc) {
      const nowUtc = new Date().toISOString().slice(0, 19).replace('T', ' ');
      if (endTimeUtc <= nowUtc) {
        errors.push({ msg: 'End time must be in the future.' });
      }
    }

    if (errors.length) {
      return res.status(400).render('new-item', { errors, values });
    }

    try {
      const info = models.createItem({
        sellerId: req.user.id,
        title: req.body.title.trim(),
        description: req.body.description.trim(),
        startingPrice: parseFloat(req.body.starting_price),
        endTime: endTimeUtc,
      });
      res.redirect(`/items/${info.lastInsertRowid}`);
    } catch (err) {
      next(err);
    }
  }
);

// ---- Detail --------------------------------------------------------------

router.get('/items/:id', idRule, (req, res, next) => {
  if (!validationResult(req).isEmpty()) {
    return next(); // falls through to 404
  }
  const item = models.getItemById(req.params.id);
  if (!item) return next();

  const seller = models.getUserById(item.seller_id);
  const highest = models.highestBidForItem(item.id);
  const history = models.bidHistoryForItem(item.id);
  const ended = itemIsEnded(item);
  const isSeller = req.user && req.user.id === item.seller_id;
  const canDelete = isSeller && history.length === 0;

  res.render('item', {
    item,
    sellerName: seller ? seller.username : 'unknown',
    highest,
    history,
    ended,
    isSeller,
    canDelete,
    winner: ended ? highest : null,
    minBid: highest ? highest.amount : item.starting_price,
    errors: req.session.bidErrors || [],
  });
  req.session.bidErrors = null;
});

// ---- Bidding -------------------------------------------------------------

router.post(
  '/items/:id/bids',
  requireAuth,
  idRule,
  body('amount').isFloat({ min: 0.01, max: 1_000_000_000 }).withMessage('Bid must be a positive number.'),
  (req, res, next) => {
    const result = validationResult(req);
    const item = result.isEmpty() ? models.getItemById(req.params.id) : null;

    if (!item) {
      req.session.bidErrors = [{ msg: 'Invalid bid.' }];
      return res.redirect(`/items/${req.params.id}`);
    }

    // Access control: a seller cannot bid on their own item.
    if (item.seller_id === req.user.id) {
      req.session.bidErrors = [{ msg: 'You cannot bid on your own item.' }];
      return res.redirect(`/items/${item.id}`);
    }

    if (itemIsEnded(item)) {
      req.session.bidErrors = [{ msg: 'This auction has ended.' }];
      return res.redirect(`/items/${item.id}`);
    }

    const amount = parseFloat(req.body.amount);

    try {
      models.placeBidTransaction(item.id, req.user.id, amount, item.starting_price);
      res.redirect(`/items/${item.id}`);
    } catch (err) {
      if (err.message === 'BID_TOO_LOW') {
        req.session.bidErrors = [
          { msg: 'Your bid must be higher than the current highest bid.' },
        ];
        return res.redirect(`/items/${item.id}`);
      }
      if (err.message === 'BID_BELOW_START') {
        req.session.bidErrors = [
          { msg: 'Your bid must be at least the starting price.' },
        ];
        return res.redirect(`/items/${item.id}`);
      }
      next(err);
    }
  }
);

// ---- Delete (own listing, no bids) ---------------------------------------

router.post('/items/:id/delete', requireAuth, idRule, (req, res, next) => {
  if (!validationResult(req).isEmpty()) return next();
  const item = models.getItemById(req.params.id);
  if (!item) return next();

  // Ownership check prevents IDOR: only the seller may delete, and only when
  // no bids have been placed.
  if (item.seller_id !== req.user.id) {
    const err = new Error('You are not allowed to modify this item.');
    err.status = 403;
    return next(err);
  }
  if (models.countBidsForItem(item.id) > 0) {
    req.session.bidErrors = [{ msg: 'Cannot delete an item that already has bids.' }];
    return res.redirect(`/items/${item.id}`);
  }
  models.deleteItem(item.id);
  res.redirect('/');
});

module.exports = router;
