'use strict';

// Seeds a few demo accounts and records so the app is explorable immediately.
// Safe to run repeatedly: it skips users that already exist.

require('dotenv').config();
const bcrypt = require('bcrypt');
const db = require('./db');
const { Users, Contacts, Deals } = require('./models');

const ROUNDS = 12;

async function ensureUser({ name, email, password, role }) {
  const existing = Users.byEmail(email);
  if (existing) return existing.id;
  const hash = await bcrypt.hash(password, ROUNDS);
  const res = Users.add({ name, email, password_hash: hash, role });
  return res.lastInsertRowid;
}

async function main() {
  const manomgrId = await ensureUser({
    name: 'Morgan Manager',
    email: 'manager@example.com',
    password: 'managerpass123',
    role: 'manager',
  });
  const aliceId = await ensureUser({
    name: 'Alice Sales',
    email: 'alice@example.com',
    password: 'alicepass123',
    role: 'sales',
  });
  const bobId = await ensureUser({
    name: 'Bob Sales',
    email: 'bob@example.com',
    password: 'bobpass1234',
    role: 'sales',
  });

  // Only seed sample records once (when there are none yet).
  const dealCount = db.prepare('SELECT COUNT(*) AS n FROM deals').get().n;
  if (dealCount === 0) {
    const c1 = Contacts.create({
      owner_id: aliceId, name: 'Acme Corp (Jane Doe)', email: 'jane@acme.test',
      phone: '555-0100', company: 'Acme Corp', notes: 'Met at trade show.',
    }).lastInsertRowid;
    const c2 = Contacts.create({
      owner_id: bobId, name: 'Globex (John Roe)', email: 'john@globex.test',
      phone: '555-0200', company: 'Globex', notes: 'Inbound lead.',
    }).lastInsertRowid;

    Deals.create({ owner_id: aliceId, contact_id: c1, title: 'Acme annual license', amount: 1200000, stage: 'proposal' });
    Deals.create({ owner_id: aliceId, contact_id: c1, title: 'Acme add-on seats', amount: 350000, stage: 'qualified' });
    Deals.create({ owner_id: bobId, contact_id: c2, title: 'Globex pilot', amount: 500000, stage: 'negotiation' });
    Deals.create({ owner_id: bobId, contact_id: c2, title: 'Globex renewal', amount: 900000, stage: 'won' });
  }

  // eslint-disable-next-line no-console
  console.log('Seed complete.\n  manager@example.com / managerpass123 (manager)\n  alice@example.com   / alicepass123 (sales)\n  bob@example.com     / bobpass1234 (sales)');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
