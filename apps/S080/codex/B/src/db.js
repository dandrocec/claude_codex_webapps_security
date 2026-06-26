const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'warehouse.sqlite');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('clerk', 'manager')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sku TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_by INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'fulfilled' CHECK (status IN ('fulfilled')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
  );

  CREATE TABLE IF NOT EXISTS order_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE RESTRICT
  );
`);

function hasUsers() {
  return db.prepare('SELECT COUNT(*) AS count FROM users').get().count > 0;
}

function findUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

function findUserById(id) {
  return db.prepare('SELECT id, username, role, created_at FROM users WHERE id = ?').get(id);
}

function createUser({ username, passwordHash, role }) {
  return db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(username, passwordHash, role);
}

const createOrder = db.transaction(({ userId, itemId, quantity }) => {
  const item = db.prepare('SELECT id, quantity FROM items WHERE id = ?').get(itemId);
  if (!item) {
    const error = new Error('Item not found');
    error.code = 'ITEM_NOT_FOUND';
    throw error;
  }
  if (item.quantity < quantity) {
    const error = new Error('Insufficient stock');
    error.code = 'INSUFFICIENT_STOCK';
    throw error;
  }

  db.prepare('UPDATE items SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(quantity, itemId);
  const order = db.prepare('INSERT INTO orders (created_by) VALUES (?)').run(userId);
  db.prepare('INSERT INTO order_lines (order_id, item_id, quantity) VALUES (?, ?, ?)').run(order.lastInsertRowid, itemId, quantity);
  return order.lastInsertRowid;
});

module.exports = {
  db,
  hasUsers,
  findUserByUsername,
  findUserById,
  createUser,
  createOrder
};
