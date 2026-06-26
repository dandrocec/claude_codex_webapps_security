const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');

const databasePath = process.env.DATABASE_PATH || path.join(__dirname, 'data', 'app.db');
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new Database(databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('customer', 'staff')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS menu_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('new', 'preparing', 'ready', 'completed', 'cancelled')) DEFAULT 'new',
    total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
    customer_note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    menu_item_id INTEGER NOT NULL,
    item_name TEXT NOT NULL,
    unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
    quantity INTEGER NOT NULL CHECK (quantity > 0 AND quantity <= 20),
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (menu_item_id) REFERENCES menu_items(id)
  );
`);

const menuCount = db.prepare('SELECT COUNT(*) AS count FROM menu_items').get().count;
if (menuCount === 0) {
  const insert = db.prepare('INSERT INTO menu_items (name, description, price_cents) VALUES (?, ?, ?)');
  const seedMenu = db.transaction(() => {
    insert.run('Margherita Pizza', 'Tomato, mozzarella, basil, and olive oil.', 1199);
    insert.run('Chicken Rice Bowl', 'Grilled chicken, seasoned rice, greens, and yogurt sauce.', 1299);
    insert.run('Garden Salad', 'Leafy greens, cucumber, tomato, seeds, and lemon vinaigrette.', 899);
    insert.run('Lentil Soup', 'Slow-cooked lentils with vegetables and toasted bread.', 749);
    insert.run('Chocolate Brownie', 'Dense cocoa brownie with a crisp top.', 499);
  });
  seedMenu();
}

async function ensureStaffUser() {
  const email = (process.env.STAFF_EMAIL || '').trim().toLowerCase();
  const password = process.env.STAFF_PASSWORD || '';
  if (!email || !password) return;

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return;

  const passwordHash = await bcrypt.hash(password, 12);
  db.prepare('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)').run(email, passwordHash, 'staff');
}

module.exports = { db, ensureStaffUser };
