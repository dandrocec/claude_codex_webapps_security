'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(path.join(DATA_DIR, 'faq.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// --- Schema ---------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS faqs (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    category  TEXT NOT NULL,
    question  TEXT NOT NULL,
    answer    TEXT NOT NULL,
    position  INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_faqs_category_position
    ON faqs (category, position);
`);

// --- Seed default editor account -----------------------------------------
function seedEditor() {
  const username = process.env.EDITOR_USERNAME || 'editor';
  const password = process.env.EDITOR_PASSWORD || 'changeme';

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (!existing) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, hash);
    console.log(`[db] Seeded editor account "${username}".`);
  }
}

// --- Seed a few sample FAQs (only on a fresh database) --------------------
function seedSampleFaqs() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM faqs').get().n;
  if (count > 0) return;

  const samples = [
    ['Getting Started', 'How do I create an account?', 'Click the Sign Up button on the home page and follow the prompts.'],
    ['Getting Started', 'Is there a free trial?', 'Yes, every new account includes a 14-day free trial with full access.'],
    ['Billing', 'Which payment methods do you accept?', 'We accept all major credit cards as well as PayPal.'],
    ['Billing', 'How do I cancel my subscription?', 'Go to Account → Billing and click "Cancel subscription". Access continues until the end of the period.'],
    ['Account', 'How do I reset my password?', 'Use the "Forgot password" link on the login page to receive a reset email.'],
  ];

  const insert = db.prepare(
    'INSERT INTO faqs (category, question, answer, position) VALUES (?, ?, ?, ?)'
  );
  const byCategory = {};
  const tx = db.transaction(() => {
    for (const [category, question, answer] of samples) {
      byCategory[category] = (byCategory[category] || 0) + 1;
      insert.run(category, question, answer, byCategory[category]);
    }
  });
  tx();
  console.log('[db] Seeded sample FAQs.');
}

seedEditor();
seedSampleFaqs();

// --- User helpers ---------------------------------------------------------
const users = {
  findByUsername(username) {
    return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  },
  verify(user, password) {
    return user && bcrypt.compareSync(password, user.password_hash);
  },
};

// --- FAQ helpers ----------------------------------------------------------
const faqs = {
  all() {
    return db
      .prepare('SELECT * FROM faqs ORDER BY category COLLATE NOCASE, position, id')
      .all();
  },

  get(id) {
    return db.prepare('SELECT * FROM faqs WHERE id = ?').get(id);
  },

  categories() {
    return db
      .prepare('SELECT DISTINCT category FROM faqs ORDER BY category COLLATE NOCASE')
      .all()
      .map((r) => r.category);
  },

  create({ category, question, answer }) {
    const next =
      db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS pos FROM faqs WHERE category = ?').get(category).pos;
    return db
      .prepare('INSERT INTO faqs (category, question, answer, position) VALUES (?, ?, ?, ?)')
      .run(category, question, answer, next);
  },

  update(id, { category, question, answer }) {
    const current = faqs.get(id);
    if (!current) return null;

    // If the category changed, append to the end of the new category.
    let position = current.position;
    if (category !== current.category) {
      position =
        db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS pos FROM faqs WHERE category = ?').get(category).pos;
    }

    return db
      .prepare('UPDATE faqs SET category = ?, question = ?, answer = ?, position = ? WHERE id = ?')
      .run(category, question, answer, position, id);
  },

  remove(id) {
    return db.prepare('DELETE FROM faqs WHERE id = ?').run(id);
  },

  // Swap an item with its neighbour (up/down) within the same category.
  move(id, direction) {
    const item = faqs.get(id);
    if (!item) return false;

    const comparator = direction === 'up' ? '<' : '>';
    const order = direction === 'up' ? 'DESC' : 'ASC';

    const neighbour = db
      .prepare(
        `SELECT * FROM faqs
         WHERE category = ? AND (position ${comparator} ? OR (position = ? AND id ${comparator} ?))
         ORDER BY position ${order}, id ${order}
         LIMIT 1`
      )
      .get(item.category, item.position, item.position, item.id);

    if (!neighbour) return false;

    const swap = db.transaction(() => {
      db.prepare('UPDATE faqs SET position = ? WHERE id = ?').run(neighbour.position, item.id);
      db.prepare('UPDATE faqs SET position = ? WHERE id = ?').run(item.position, neighbour.id);
      // Guard against equal positions so the swap is always observable.
      if (neighbour.position === item.position) {
        db.prepare('UPDATE faqs SET position = position + 1 WHERE id = ?').run(
          direction === 'up' ? neighbour.id : item.id
        );
      }
    });
    swap();
    return true;
  },
};

module.exports = { db, users, faqs };
