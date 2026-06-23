'use strict';

/**
 * Database layer.
 *
 * Uses better-sqlite3 with prepared statements. EVERY query that touches user
 * input uses bound parameters (?), never string concatenation, which prevents
 * SQL injection.
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(path.join(DATA_DIR, 'app.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'customer'
                     CHECK (role IN ('customer', 'staff')),
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS menu_items (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
      available   INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0, 1)),
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS orders (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status      TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'preparing', 'ready', 'completed', 'cancelled')),
      total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id         INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      menu_item_id     INTEGER NOT NULL REFERENCES menu_items(id),
      name             TEXT NOT NULL,
      unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
      quantity         INTEGER NOT NULL CHECK (quantity > 0)
    );

    CREATE INDEX IF NOT EXISTS idx_orders_user   ON orders(user_id);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
  `);
}

/**
 * Seed initial menu data and the staff account. Idempotent.
 */
function seed() {
  const menuCount = db.prepare('SELECT COUNT(*) AS n FROM menu_items').get().n;
  if (menuCount === 0) {
    const insert = db.prepare(
      'INSERT INTO menu_items (name, description, price_cents) VALUES (?, ?, ?)'
    );
    const items = [
      ['Margherita Pizza', 'Tomato, mozzarella, fresh basil', 1099],
      ['Cheeseburger', 'Beef patty, cheddar, lettuce, house sauce', 899],
      ['Caesar Salad', 'Romaine, parmesan, croutons, Caesar dressing', 749],
      ['Spaghetti Bolognese', 'Slow-cooked beef ragù over spaghetti', 1149],
      ['Veggie Wrap', 'Grilled vegetables, hummus, spinach', 699],
      ['French Fries', 'Crispy golden fries with sea salt', 399],
      ['Chocolate Brownie', 'Warm brownie with a fudgy centre', 499],
      ['Sparkling Water', '500ml bottle', 249]
    ];
    const insertMany = db.transaction((rows) => {
      for (const row of rows) insert.run(...row);
    });
    insertMany(items);
    console.log(`Seeded ${items.length} menu items.`);
  }

  // Create the staff account if missing.
  const staffUsername = (process.env.STAFF_USERNAME || 'staff').trim();
  const existing = db
    .prepare('SELECT id FROM users WHERE username = ?')
    .get(staffUsername);

  if (!existing) {
    const password = process.env.STAFF_PASSWORD || 'ChangeMe!Staff123';
    const hash = bcrypt.hashSync(password, 12);
    db.prepare(
      'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)'
    ).run(staffUsername, `${staffUsername}@example.com`, hash, 'staff');
    console.log(`Created staff user "${staffUsername}".`);
  }
}

migrate();

// Allow running `node db.js --seed` standalone.
if (require.main === module && process.argv.includes('--seed')) {
  require('dotenv').config();
  seed();
  console.log('Seed complete.');
}

module.exports = { db, seed };
