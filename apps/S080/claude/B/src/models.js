'use strict';

// All database access goes through parameterised prepared statements,
// which prevents SQL injection.
const db = require('./db');
const { AppError } = require('./errors');

const Users = {
  findByUsername(username) {
    return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  },
  findById(id) {
    return db.prepare('SELECT id, username, role, created_at FROM users WHERE id = ?').get(id);
  },
  create({ username, passwordHash, role }) {
    const info = db
      .prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
      .run(username, passwordHash, role);
    return info.lastInsertRowid;
  },
};

const Products = {
  all() {
    return db.prepare('SELECT * FROM products ORDER BY name COLLATE NOCASE').all();
  },
  findById(id) {
    return db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  },
  findBySku(sku) {
    return db.prepare('SELECT * FROM products WHERE sku = ?').get(sku);
  },
  create({ sku, name, stock }) {
    const info = db
      .prepare('INSERT INTO products (sku, name, stock) VALUES (?, ?, ?)')
      .run(sku, name, stock);
    return info.lastInsertRowid;
  },
  setStock(id, stock) {
    return db.prepare('UPDATE products SET stock = ? WHERE id = ?').run(stock, id);
  },
};

const Orders = {
  // Creating an order fulfils it immediately: stock is checked and
  // decremented atomically inside a transaction so concurrent requests
  // cannot oversell.
  create: db.transaction(({ productId, quantity, userId }) => {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
    if (!product) {
      throw new AppError('Product not found.', 404);
    }
    if (product.stock < quantity) {
      throw new AppError(
        `Insufficient stock for "${product.name}". Available: ${product.stock}, requested: ${quantity}.`,
        409
      );
    }
    db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(quantity, productId);
    const info = db
      .prepare(
        'INSERT INTO orders (product_id, quantity, status, created_by) VALUES (?, ?, ?, ?)'
      )
      .run(productId, quantity, 'fulfilled', userId);
    return info.lastInsertRowid;
  }),

  // Cancelling restores stock. Runs atomically.
  cancel: db.transaction((orderId) => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) {
      throw new AppError('Order not found.', 404);
    }
    if (order.status === 'cancelled') {
      throw new AppError('Order is already cancelled.', 409);
    }
    db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(
      order.quantity,
      order.product_id
    );
    db.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").run(orderId);
  }),

  findById(id) {
    return db
      .prepare(
        `SELECT o.*, p.name AS product_name, p.sku AS product_sku, u.username AS created_by_username
         FROM orders o
         JOIN products p ON p.id = o.product_id
         JOIN users u ON u.id = o.created_by
         WHERE o.id = ?`
      )
      .get(id);
  },

  // Managers see all orders; clerks see only their own.
  list({ userId = null } = {}) {
    if (userId === null) {
      return db
        .prepare(
          `SELECT o.*, p.name AS product_name, p.sku AS product_sku, u.username AS created_by_username
           FROM orders o
           JOIN products p ON p.id = o.product_id
           JOIN users u ON u.id = o.created_by
           ORDER BY o.created_at DESC, o.id DESC`
        )
        .all();
    }
    return db
      .prepare(
        `SELECT o.*, p.name AS product_name, p.sku AS product_sku, u.username AS created_by_username
         FROM orders o
         JOIN products p ON p.id = o.product_id
         JOIN users u ON u.id = o.created_by
         WHERE o.created_by = ?
         ORDER BY o.created_at DESC, o.id DESC`
      )
      .all(userId);
  },
};

module.exports = { Users, Products, Orders };
