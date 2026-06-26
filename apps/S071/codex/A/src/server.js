const path = require('path');
const express = require('express');
const methodOverride = require('method-override');
const db = require('./db');

const app = express();
const PORT = Number(process.env.PORT || 5071);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: false }));
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));

app.locals.formatMoney = (cents) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

app.locals.formatDate = (value) =>
  new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));

function toCents(input) {
  const normalized = String(input || '').replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    return null;
  }
  return Math.round(Number(normalized) * 100);
}

function getAuction(id) {
  return db.prepare(`
    SELECT
      a.*,
      hb.amount_cents AS high_bid_cents,
      hb.bidder_name AS high_bidder_name,
      hb.created_at AS high_bid_time,
      COUNT(b.id) AS bid_count
    FROM auctions a
    LEFT JOIN bids b ON b.auction_id = a.id
    LEFT JOIN (
      SELECT auction_id, bidder_name, amount_cents, created_at
      FROM bids
      WHERE auction_id = ?
      ORDER BY amount_cents DESC, created_at ASC
      LIMIT 1
    ) hb ON hb.auction_id = a.id
    WHERE a.id = ?
    GROUP BY a.id
  `).get(id, id);
}

function currentPrice(auction) {
  return auction.high_bid_cents || auction.starting_price_cents;
}

function decorateAuction(auction) {
  const now = Date.now();
  const endMs = new Date(auction.end_time).getTime();
  return {
    ...auction,
    current_price_cents: currentPrice(auction),
    is_ended: endMs <= now,
    status_label: endMs <= now ? 'Ended' : 'Live'
  };
}

app.get('/', (req, res) => {
  const auctions = db.prepare(`
    SELECT
      a.*,
      hb.amount_cents AS high_bid_cents,
      hb.bidder_name AS high_bidder_name,
      COUNT(b.id) AS bid_count
    FROM auctions a
    LEFT JOIN bids b ON b.auction_id = a.id
    LEFT JOIN (
      SELECT x.auction_id, x.bidder_name, x.amount_cents
      FROM bids x
      INNER JOIN (
        SELECT auction_id, MAX(amount_cents) AS amount_cents
        FROM bids
        GROUP BY auction_id
      ) mx ON mx.auction_id = x.auction_id AND mx.amount_cents = x.amount_cents
      GROUP BY x.auction_id
    ) hb ON hb.auction_id = a.id
    GROUP BY a.id
    ORDER BY datetime(a.end_time) ASC
  `).all().map(decorateAuction);

  res.render('index', { auctions });
});

app.get('/auctions/new', (req, res) => {
  res.render('new-auction', { errors: [], values: {} });
});

app.post('/auctions', (req, res) => {
  const values = {
    title: String(req.body.title || '').trim(),
    description: String(req.body.description || '').trim(),
    sellerName: String(req.body.sellerName || '').trim(),
    startingPrice: String(req.body.startingPrice || '').trim(),
    endTime: String(req.body.endTime || '').trim()
  };

  const startingPriceCents = toCents(values.startingPrice);
  const endDate = values.endTime ? new Date(values.endTime) : null;
  const errors = [];

  if (!values.title) errors.push('Item title is required.');
  if (!values.description) errors.push('Description is required.');
  if (!values.sellerName) errors.push('Seller name is required.');
  if (!startingPriceCents) errors.push('Starting price must be a valid amount above zero.');
  if (!endDate || Number.isNaN(endDate.getTime())) errors.push('End time must be valid.');
  if (endDate && endDate.getTime() <= Date.now()) errors.push('End time must be in the future.');

  if (errors.length) {
    return res.status(422).render('new-auction', { errors, values });
  }

  const result = db.prepare(`
    INSERT INTO auctions (title, description, seller_name, starting_price_cents, end_time)
    VALUES (?, ?, ?, ?, ?)
  `).run(values.title, values.description, values.sellerName, startingPriceCents, endDate.toISOString());

  res.redirect(`/auctions/${result.lastInsertRowid}`);
});

app.get('/auctions/:id', (req, res) => {
  const auction = getAuction(req.params.id);
  if (!auction) {
    return res.status(404).render('not-found');
  }

  const bids = db.prepare(`
    SELECT *
    FROM bids
    WHERE auction_id = ?
    ORDER BY amount_cents DESC, datetime(created_at) ASC
  `).all(req.params.id);

  res.render('auction', {
    auction: decorateAuction(auction),
    bids,
    errors: [],
    values: {}
  });
});

app.post('/auctions/:id/bids', (req, res) => {
  const auction = getAuction(req.params.id);
  if (!auction) {
    return res.status(404).render('not-found');
  }

  const decorated = decorateAuction(auction);
  const values = {
    bidderName: String(req.body.bidderName || '').trim(),
    amount: String(req.body.amount || '').trim()
  };
  const amountCents = toCents(values.amount);
  const errors = [];

  if (decorated.is_ended) errors.push('This auction has ended.');
  if (!values.bidderName) errors.push('Bidder name is required.');
  if (!amountCents) errors.push('Bid amount must be a valid amount above zero.');
  if (amountCents && amountCents <= decorated.current_price_cents) {
    errors.push(`Bid must exceed the current price of ${app.locals.formatMoney(decorated.current_price_cents)}.`);
  }

  const bids = db.prepare(`
    SELECT *
    FROM bids
    WHERE auction_id = ?
    ORDER BY amount_cents DESC, datetime(created_at) ASC
  `).all(req.params.id);

  if (errors.length) {
    return res.status(422).render('auction', { auction: decorated, bids, errors, values });
  }

  db.prepare(`
    INSERT INTO bids (auction_id, bidder_name, amount_cents)
    VALUES (?, ?, ?)
  `).run(req.params.id, values.bidderName, amountCents);

  res.redirect(`/auctions/${req.params.id}`);
});

app.use((req, res) => {
  res.status(404).render('not-found');
});

app.listen(PORT, () => {
  console.log(`Auction site running at http://localhost:${PORT}`);
});
