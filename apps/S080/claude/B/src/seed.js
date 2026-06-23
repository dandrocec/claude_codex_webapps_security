'use strict';

// Seeds initial demo accounts and a few products.
// Run once with: npm run seed
const bcrypt = require('bcryptjs');
const config = require('./config');
const db = require('./db');
const { Users, Products } = require('./models');

const BCRYPT_ROUNDS = 12;

function ensureUser(username, password, role) {
  if (!username || !password) {
    console.error(
      `Skipping ${role}: missing username/password. Set SEED_${role.toUpperCase()}_USERNAME / _PASSWORD in .env`
    );
    return;
  }
  if (Users.findByUsername(username)) {
    console.log(`User "${username}" already exists — skipping.`);
    return;
  }
  const hash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
  Users.create({ username, passwordHash: hash, role });
  console.log(`Created ${role}: ${username}`);
}

function ensureProduct(sku, name, stock) {
  if (Products.findBySku(sku)) {
    return;
  }
  Products.create({ sku, name, stock });
  console.log(`Created product: ${sku} (${name})`);
}

ensureUser(config.seed.managerUsername, config.seed.managerPassword, 'manager');
ensureUser(config.seed.clerkUsername, config.seed.clerkPassword, 'clerk');

ensureProduct('WIDGET-001', 'Standard Widget', 100);
ensureProduct('GADGET-002', 'Premium Gadget', 25);
ensureProduct('BOLT-003', 'Steel Bolt (pack of 50)', 500);

console.log('Seed complete.');
db.close();
