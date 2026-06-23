'use strict';

// Seeds the database with the schema, two demo users (one per role),
// and a handful of products. Idempotent: running it again only inserts
// rows that are missing.

const bcrypt = require('bcryptjs');
const db = require('./connection');
const initSchema = require('./schema');

initSchema();

const upsertUser = db.prepare(`
  INSERT INTO users (username, password_hash, role)
  VALUES (@username, @password_hash, @role)
  ON CONFLICT(username) DO NOTHING
`);

const users = [
  { username: 'manager', password: 'manager123', role: 'manager' },
  { username: 'clerk', password: 'clerk123', role: 'clerk' },
];

for (const u of users) {
  upsertUser.run({
    username: u.username,
    password_hash: bcrypt.hashSync(u.password, 10),
    role: u.role,
  });
}

const upsertProduct = db.prepare(`
  INSERT INTO products (sku, name, quantity)
  VALUES (@sku, @name, @quantity)
  ON CONFLICT(sku) DO NOTHING
`);

const products = [
  { sku: 'WIDGET-001', name: 'Standard Widget', quantity: 100 },
  { sku: 'GADGET-002', name: 'Deluxe Gadget', quantity: 40 },
  { sku: 'BOLT-003', name: 'Steel Bolt (pack of 50)', quantity: 250 },
  { sku: 'CABLE-004', name: 'USB-C Cable 2m', quantity: 15 },
];

for (const p of products) {
  upsertProduct.run(p);
}

console.log('Database seeded.');
console.log('  manager / manager123  (role: manager)');
console.log('  clerk   / clerk123    (role: clerk)');
