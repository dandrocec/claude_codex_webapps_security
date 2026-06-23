'use strict';

const db = require('./db');

// All queries below use bound parameters (?) — never string concatenation —
// which prevents SQL injection.

const stmts = {
  createUser: db.prepare(
    'INSERT INTO users (username, password_hash) VALUES (?, ?)'
  ),
  getUserByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
  getUserById: db.prepare('SELECT id, username, created_at FROM users WHERE id = ?'),

  createItem: db.prepare(
    `INSERT INTO items (seller_id, title, description, starting_price, end_time)
     VALUES (?, ?, ?, ?, ?)`
  ),
  getItemById: db.prepare('SELECT * FROM items WHERE id = ?'),
  listItems: db.prepare(
    `SELECT i.*, u.username AS seller_name,
            (SELECT MAX(amount) FROM bids WHERE item_id = i.id) AS highest_bid,
            (i.end_time <= datetime('now')) AS ended
       FROM items i
       JOIN users u ON u.id = i.seller_id
      ORDER BY (i.end_time <= datetime('now')) ASC, i.end_time ASC`
  ),
  deleteItem: db.prepare('DELETE FROM items WHERE id = ?'),

  createBid: db.prepare(
    'INSERT INTO bids (item_id, bidder_id, amount) VALUES (?, ?, ?)'
  ),
  highestBidForItem: db.prepare(
    `SELECT b.*, u.username AS bidder_name
       FROM bids b
       JOIN users u ON u.id = b.bidder_id
      WHERE b.item_id = ?
      ORDER BY b.amount DESC, b.created_at ASC
      LIMIT 1`
  ),
  bidHistoryForItem: db.prepare(
    `SELECT b.amount, b.created_at, u.username AS bidder_name
       FROM bids b
       JOIN users u ON u.id = b.bidder_id
      WHERE b.item_id = ?
      ORDER BY b.amount DESC, b.created_at ASC`
  ),
  countBidsForItem: db.prepare('SELECT COUNT(*) AS n FROM bids WHERE item_id = ?'),
};

module.exports = {
  createUser(username, passwordHash) {
    return stmts.createUser.run(username, passwordHash);
  },
  getUserByUsername(username) {
    return stmts.getUserByUsername.get(username);
  },
  getUserById(id) {
    return stmts.getUserById.get(id);
  },

  createItem({ sellerId, title, description, startingPrice, endTime }) {
    return stmts.createItem.run(sellerId, title, description, startingPrice, endTime);
  },
  getItemById(id) {
    return stmts.getItemById.get(id);
  },
  listItems() {
    return stmts.listItems.all();
  },
  deleteItem(id) {
    return stmts.deleteItem.run(id);
  },

  createBid(itemId, bidderId, amount) {
    return stmts.createBid.run(itemId, bidderId, amount);
  },
  highestBidForItem(itemId) {
    return stmts.highestBidForItem.get(itemId);
  },
  bidHistoryForItem(itemId) {
    return stmts.bidHistoryForItem.all(itemId);
  },
  countBidsForItem(itemId) {
    return stmts.countBidsForItem.get(itemId).n;
  },

  // Place a bid atomically: re-check the highest bid inside a transaction so two
  // concurrent bids cannot both "win" against a stale maximum.
  placeBidTransaction: db.transaction((itemId, bidderId, amount, minAcceptable) => {
    const current = stmts.highestBidForItem.get(itemId);
    if (current && amount <= current.amount) {
      throw new Error('BID_TOO_LOW');
    }
    if (!current && amount < minAcceptable) {
      throw new Error('BID_BELOW_START');
    }
    return stmts.createBid.run(itemId, bidderId, amount);
  }),
};
