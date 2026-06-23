'use strict';

const path = require('path');
const express = require('express');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 5071;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

// View helpers available to every template.
app.locals.money = (n) => `$${Number(n).toFixed(2)}`;
app.locals.dateTime = (value) => {
  // Accepts ISO-8601 strings and SQLite "YYYY-MM-DD HH:MM:SS" (UTC) values.
  let s = String(value);
  if (s.includes(' ') && !s.includes('T')) s = s.replace(' ', 'T') + 'Z';
  return new Date(s).toLocaleString();
};

// ---------------------------------------------------------------------------
// Prepared statements
// ---------------------------------------------------------------------------
const stmts = {
  insertItem: db.prepare(`
    INSERT INTO items (title, description, seller, starting_price, end_time)
    VALUES (@title, @description, @seller, @starting_price, @end_time)
  `),
  getItem: db.prepare(`SELECT * FROM items WHERE id = ?`),
  allItems: db.prepare(`SELECT * FROM items ORDER BY end_time ASC`),
  highestBid: db.prepare(`
    SELECT bidder, amount FROM bids
    WHERE item_id = ?
    ORDER BY amount DESC, id ASC
    LIMIT 1
  `),
  bidsForItem: db.prepare(`
    SELECT bidder, amount, created_at FROM bids
    WHERE item_id = ?
    ORDER BY amount DESC, id ASC
  `),
  insertBid: db.prepare(`
    INSERT INTO bids (item_id, bidder, amount) VALUES (?, ?, ?)
  `),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function decorate(item) {
  const highest = stmts.highestBid.get(item.id);
  const ended = Date.now() >= new Date(item.end_time).getTime();
  return {
    ...item,
    ended,
    currentPrice: highest ? highest.amount : item.starting_price,
    highestBidder: highest ? highest.bidder : null,
    // Minimum acceptable next bid.
    minNextBid: highest ? highest.amount + 0.01 : item.starting_price,
  };
}

/**
 * Atomically place a bid. Re-reads the highest bid inside the transaction so
 * two simultaneous bidders cannot both "win" the same amount.
 * Throws Error with a user-facing message on validation failure.
 */
const placeBid = db.transaction((itemId, bidder, amount) => {
  const item = stmts.getItem.get(itemId);
  if (!item) throw new Error('Item not found.');
  if (Date.now() >= new Date(item.end_time).getTime()) {
    throw new Error('This auction has already ended.');
  }
  const highest = stmts.highestBid.get(itemId);
  if (highest) {
    if (amount <= highest.amount) {
      throw new Error(`Bid must exceed the current highest bid of $${highest.amount.toFixed(2)}.`);
    }
  } else if (amount < item.starting_price) {
    throw new Error(`Bid must be at least the starting price of $${item.starting_price.toFixed(2)}.`);
  }
  stmts.insertBid.run(itemId, bidder, amount);
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.get('/', (req, res) => {
  const items = stmts.allItems.all().map(decorate);
  res.render('index', { items });
});

app.get('/items/new', (req, res) => {
  // Default end time: 1 hour from now, formatted for <input type="datetime-local">.
  const inOneHour = new Date(Date.now() + 60 * 60 * 1000);
  const tzOffset = inOneHour.getTimezoneOffset() * 60000;
  const defaultEnd = new Date(inOneHour.getTime() - tzOffset).toISOString().slice(0, 16);
  res.render('new', { defaultEnd, error: null, values: {} });
});

app.post('/items', (req, res) => {
  const { title, description, seller, starting_price, end_time } = req.body;
  const values = { title, description, seller, starting_price, end_time };

  const price = Number(starting_price);
  const end = new Date(end_time);
  const errors = [];

  if (!title || !title.trim()) errors.push('Title is required.');
  if (!seller || !seller.trim()) errors.push('Seller name is required.');
  if (!Number.isFinite(price) || price < 0) errors.push('Starting price must be a non-negative number.');
  if (!end_time || Number.isNaN(end.getTime())) errors.push('A valid end time is required.');
  else if (end.getTime() <= Date.now()) errors.push('End time must be in the future.');

  if (errors.length) {
    return res.status(400).render('new', { defaultEnd: end_time || '', error: errors.join(' '), values });
  }

  const info = stmts.insertItem.run({
    title: title.trim(),
    description: (description || '').trim(),
    seller: seller.trim(),
    starting_price: price,
    end_time: end.toISOString(),
  });
  res.redirect(`/items/${info.lastInsertRowid}`);
});

app.get('/items/:id', (req, res) => {
  const item = stmts.getItem.get(req.params.id);
  if (!item) return res.status(404).render('404');
  const decorated = decorate(item);
  const bids = stmts.bidsForItem.all(item.id);
  res.render('item', { item: decorated, bids, error: req.query.error || null });
});

app.post('/items/:id/bids', (req, res) => {
  const itemId = Number(req.params.id);
  const bidder = (req.body.bidder || '').trim();
  const amount = Number(req.body.amount);

  if (!bidder) {
    return res.redirect(`/items/${itemId}?error=${encodeURIComponent('Your name is required to bid.')}`);
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.redirect(`/items/${itemId}?error=${encodeURIComponent('Bid amount must be a positive number.')}`);
  }

  try {
    placeBid(itemId, bidder, amount);
    res.redirect(`/items/${itemId}`);
  } catch (err) {
    res.redirect(`/items/${itemId}?error=${encodeURIComponent(err.message)}`);
  }
});

app.use((req, res) => res.status(404).render('404'));

app.listen(PORT, () => {
  console.log(`Auction site running at http://localhost:${PORT}`);
});
