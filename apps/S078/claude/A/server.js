'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const methodOverride = require('method-override');
const bcrypt = require('bcryptjs');

const { db, init, STAGES } = require('./db');
const { seed } = require('./seed');

const PORT = process.env.PORT || 5078;
const app = express();

// ---------------------------------------------------------------------------
// Bootstrap: ensure schema exists and seed demo data on first run.
// ---------------------------------------------------------------------------
init();
if (seed()) {
  console.log('First run: seeded demo data (logins printed in the README).');
}

// ---------------------------------------------------------------------------
// App / middleware setup
// ---------------------------------------------------------------------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-only-secret-change-me',
    resave: false,
    saveUninitialized: false,
  })
);

// Make current user + helpers available to every view.
app.use((req, res, next) => {
  req.user = req.session.userId
    ? db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(req.session.userId)
    : null;
  res.locals.currentUser = req.user;
  res.locals.STAGES = STAGES;
  res.locals.stageLabel = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  res.locals.money = (n) =>
    '$' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
  next();
});

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------
function requireLogin(req, res, next) {
  if (!req.user) return res.redirect('/login');
  next();
}

// A non-manager may only touch rows they own.
function canAccess(req, ownerId) {
  return req.user.role === 'manager' || ownerId === req.user.id;
}

// ---------------------------------------------------------------------------
// Auth routes
// ---------------------------------------------------------------------------
app.get('/login', (req, res) => {
  if (req.user) return res.redirect('/board');
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get((email || '').trim().toLowerCase());
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).render('login', { error: 'Invalid email or password.' });
  }
  req.session.userId = user.id;
  res.redirect('/board');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// ---------------------------------------------------------------------------
// Home -> board
// ---------------------------------------------------------------------------
app.get('/', requireLogin, (req, res) => res.redirect('/board'));

// ---------------------------------------------------------------------------
// Pipeline board (kanban)
// ---------------------------------------------------------------------------
app.get('/board', requireLogin, (req, res) => {
  const scoped = req.user.role !== 'manager';
  const deals = db
    .prepare(
      `SELECT d.*, c.name AS contact_name, u.name AS owner_name
         FROM deals d
         LEFT JOIN contacts c ON c.id = d.contact_id
         JOIN users u ON u.id = d.owner_id
        ${scoped ? 'WHERE d.owner_id = ?' : ''}
        ORDER BY d.updated_at DESC`
    )
    .all(...(scoped ? [req.user.id] : []));

  const columns = STAGES.map((stage) => {
    const items = deals.filter((d) => d.stage === stage);
    const total = items.reduce((sum, d) => sum + Number(d.value || 0), 0);
    return { stage, items, total };
  });

  res.render('board', { columns });
});

// Move a deal to another stage (used by the ◀ / ▶ buttons on each card).
app.post('/deals/:id/stage', requireLogin, (req, res) => {
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  if (!deal || !canAccess(req, deal.owner_id)) return res.status(404).send('Not found');
  const stage = req.body.stage;
  if (!STAGES.includes(stage)) return res.status(400).send('Invalid stage');
  db.prepare("UPDATE deals SET stage = ?, updated_at = datetime('now') WHERE id = ?").run(stage, deal.id);
  res.redirect('/board');
});

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------
app.get('/contacts', requireLogin, (req, res) => {
  const scoped = req.user.role !== 'manager';
  const contacts = db
    .prepare(
      `SELECT c.*, u.name AS owner_name,
              (SELECT COUNT(*) FROM deals d WHERE d.contact_id = c.id) AS deal_count
         FROM contacts c
         JOIN users u ON u.id = c.owner_id
        ${scoped ? 'WHERE c.owner_id = ?' : ''}
        ORDER BY c.name`
    )
    .all(...(scoped ? [req.user.id] : []));
  res.render('contacts/index', { contacts });
});

app.get('/contacts/new', requireLogin, (req, res) => {
  res.render('contacts/form', { contact: {}, action: '/contacts', method: 'POST', title: 'New Contact' });
});

app.post('/contacts', requireLogin, (req, res) => {
  const { name, email, phone, company } = req.body;
  if (!name || !name.trim()) return res.status(400).send('Name is required');
  db.prepare(
    'INSERT INTO contacts (name, email, phone, company, owner_id) VALUES (?, ?, ?, ?, ?)'
  ).run(name.trim(), email || null, phone || null, company || null, req.user.id);
  res.redirect('/contacts');
});

app.get('/contacts/:id/edit', requireLogin, (req, res) => {
  const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id);
  if (!contact || !canAccess(req, contact.owner_id)) return res.status(404).send('Not found');
  res.render('contacts/form', {
    contact,
    action: `/contacts/${contact.id}?_method=PUT`,
    method: 'POST',
    title: 'Edit Contact',
  });
});

app.put('/contacts/:id', requireLogin, (req, res) => {
  const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id);
  if (!contact || !canAccess(req, contact.owner_id)) return res.status(404).send('Not found');
  const { name, email, phone, company } = req.body;
  if (!name || !name.trim()) return res.status(400).send('Name is required');
  db.prepare('UPDATE contacts SET name = ?, email = ?, phone = ?, company = ? WHERE id = ?').run(
    name.trim(),
    email || null,
    phone || null,
    company || null,
    contact.id
  );
  res.redirect('/contacts');
});

app.delete('/contacts/:id', requireLogin, (req, res) => {
  const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id);
  if (!contact || !canAccess(req, contact.owner_id)) return res.status(404).send('Not found');
  db.prepare('DELETE FROM contacts WHERE id = ?').run(contact.id);
  res.redirect('/contacts');
});

// ---------------------------------------------------------------------------
// Deals
// ---------------------------------------------------------------------------
app.get('/deals', requireLogin, (req, res) => {
  const scoped = req.user.role !== 'manager';
  const deals = db
    .prepare(
      `SELECT d.*, c.name AS contact_name, u.name AS owner_name
         FROM deals d
         LEFT JOIN contacts c ON c.id = d.contact_id
         JOIN users u ON u.id = d.owner_id
        ${scoped ? 'WHERE d.owner_id = ?' : ''}
        ORDER BY d.updated_at DESC`
    )
    .all(...(scoped ? [req.user.id] : []));
  res.render('deals/index', { deals });
});

// Contacts the current user may attach a deal to.
function selectableContacts(req) {
  const scoped = req.user.role !== 'manager';
  return db
    .prepare(`SELECT id, name FROM contacts ${scoped ? 'WHERE owner_id = ?' : ''} ORDER BY name`)
    .all(...(scoped ? [req.user.id] : []));
}

app.get('/deals/new', requireLogin, (req, res) => {
  res.render('deals/form', {
    deal: { stage: 'lead', value: 0 },
    contacts: selectableContacts(req),
    action: '/deals',
    method: 'POST',
    title: 'New Deal',
  });
});

app.post('/deals', requireLogin, (req, res) => {
  const { title, value, stage, contact_id } = req.body;
  if (!title || !title.trim()) return res.status(400).send('Title is required');
  const dealStage = STAGES.includes(stage) ? stage : 'lead';
  db.prepare(
    'INSERT INTO deals (title, value, stage, contact_id, owner_id) VALUES (?, ?, ?, ?, ?)'
  ).run(title.trim(), Number(value) || 0, dealStage, contact_id || null, req.user.id);
  res.redirect('/board');
});

app.get('/deals/:id/edit', requireLogin, (req, res) => {
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  if (!deal || !canAccess(req, deal.owner_id)) return res.status(404).send('Not found');
  res.render('deals/form', {
    deal,
    contacts: selectableContacts(req),
    action: `/deals/${deal.id}?_method=PUT`,
    method: 'POST',
    title: 'Edit Deal',
  });
});

app.put('/deals/:id', requireLogin, (req, res) => {
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  if (!deal || !canAccess(req, deal.owner_id)) return res.status(404).send('Not found');
  const { title, value, stage, contact_id } = req.body;
  if (!title || !title.trim()) return res.status(400).send('Title is required');
  const dealStage = STAGES.includes(stage) ? stage : deal.stage;
  db.prepare(
    "UPDATE deals SET title = ?, value = ?, stage = ?, contact_id = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(title.trim(), Number(value) || 0, dealStage, contact_id || null, deal.id);
  res.redirect('/board');
});

app.delete('/deals/:id', requireLogin, (req, res) => {
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  if (!deal || !canAccess(req, deal.owner_id)) return res.status(404).send('Not found');
  db.prepare('DELETE FROM deals WHERE id = ?').run(deal.id);
  res.redirect('/deals');
});

// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Mini CRM running at http://localhost:${PORT}`);
});
