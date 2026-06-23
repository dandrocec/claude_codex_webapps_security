'use strict';

// Idempotent seed: creates demo users plus sample contacts & deals.
// Exposed as seed() so the server can auto-seed an empty DB on first start,
// and also runnable directly via `npm run seed`.
const bcrypt = require('bcryptjs');
const { db, init } = require('./db');

function seed() {
  init();

  const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (userCount > 0) return false; // already seeded

  const insertUser = db.prepare(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)'
  );
  const makeUser = (name, email, password, role) =>
    insertUser.run(name, email, bcrypt.hashSync(password, 10), role).lastInsertRowid;

  const aliceId = makeUser('Alice Sales', 'alice@example.com', 'password', 'sales');
  const bobId   = makeUser('Bob Sales',   'bob@example.com',   'password', 'sales');
  makeUser('Morgan Manager', 'manager@example.com', 'password', 'manager');

  const insertContact = db.prepare(
    'INSERT INTO contacts (name, email, phone, company, owner_id) VALUES (?, ?, ?, ?, ?)'
  );
  const insertDeal = db.prepare(
    'INSERT INTO deals (title, value, stage, contact_id, owner_id) VALUES (?, ?, ?, ?, ?)'
  );

  const seedFor = (ownerId, label) => {
    const c1 = insertContact.run(`Acme Inc (${label})`,   'buyer@acme.test', '555-0100', 'Acme Inc',   ownerId).lastInsertRowid;
    const c2 = insertContact.run(`Globex LLC (${label})`, 'ops@globex.test', '555-0101', 'Globex LLC', ownerId).lastInsertRowid;
    insertDeal.run(`${label}: starter plan`,   5000,  'lead',        c1, ownerId);
    insertDeal.run(`${label}: pro upgrade`,    12000, 'qualified',   c1, ownerId);
    insertDeal.run(`${label}: enterprise`,     48000, 'proposal',    c2, ownerId);
    insertDeal.run(`${label}: renewal`,        9000,  'negotiation', c2, ownerId);
    insertDeal.run(`${label}: pilot (closed)`, 3000,  'won',         c1, ownerId);
  };

  seedFor(aliceId, 'Alice');
  seedFor(bobId, 'Bob');
  return true;
}

module.exports = { seed };

// Run directly: `node seed.js` / `npm run seed`
if (require.main === module) {
  const created = seed();
  if (created) {
    console.log('Seed complete. Demo logins (all use password "password"):');
    console.log('  manager@example.com   (manager — sees the whole team)');
    console.log('  alice@example.com     (sales)');
    console.log('  bob@example.com       (sales)');
  } else {
    console.log('Database already seeded — nothing to do.');
  }
}
