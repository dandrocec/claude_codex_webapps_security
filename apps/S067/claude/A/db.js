'use strict';

/**
 * Database setup + seed data.
 *
 * Uses better-sqlite3 (synchronous, embedded). The database file lives at
 * ./data/app.db and is created automatically on first run. Prices are stored
 * as integer cents to avoid floating-point rounding errors.
 *
 * This module can also be run directly (`npm run seed`) to (re)initialise the
 * schema and seed the menu.
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(path.join(DATA_DIR, 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS menu_items (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      description TEXT    NOT NULL DEFAULT '',
      category    TEXT    NOT NULL DEFAULT 'Other',
      price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
      available   INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS orders (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT    NOT NULL,
      status        TEXT    NOT NULL DEFAULT 'pending',
      total_cents   INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id        INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      menu_item_id    INTEGER NOT NULL REFERENCES menu_items(id),
      name            TEXT    NOT NULL,
      unit_price_cents INTEGER NOT NULL,
      quantity        INTEGER NOT NULL CHECK (quantity > 0)
    );

    CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
  `);
}

function seed() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM menu_items').get().n;
  if (count > 0) return; // already seeded

  const items = [
    ['Margherita Pizza', 'Tomato, mozzarella, fresh basil', 'Mains', 1099],
    ['Pepperoni Pizza', 'Tomato, mozzarella, pepperoni', 'Mains', 1249],
    ['Classic Cheeseburger', 'Beef patty, cheddar, lettuce, house sauce', 'Mains', 999],
    ['Caesar Salad', 'Romaine, parmesan, croutons, Caesar dressing', 'Starters', 749],
    ['Garlic Bread', 'Toasted baguette with garlic butter', 'Starters', 499],
    ['French Fries', 'Crispy golden fries with sea salt', 'Sides', 399],
    ['Chocolate Brownie', 'Warm brownie with vanilla ice cream', 'Desserts', 599],
    ['Sparkling Water', '330ml chilled sparkling water', 'Drinks', 249],
    ['Cola', '330ml can', 'Drinks', 199],
    ['Fresh Lemonade', 'House-made, lightly sweetened', 'Drinks', 349]
  ];

  const insert = db.prepare(
    'INSERT INTO menu_items (name, description, category, price_cents) VALUES (?, ?, ?, ?)'
  );
  const insertMany = db.transaction((rows) => {
    for (const row of rows) insert.run(...row);
  });
  insertMany(items);
}

init();
seed();

module.exports = db;

// Allow running `node db.js` directly to (re)initialise + report status.
if (require.main === module) {
  const n = db.prepare('SELECT COUNT(*) AS n FROM menu_items').get().n;
  console.log(`Database ready at ${path.join(DATA_DIR, 'app.db')} (${n} menu items).`);
}
