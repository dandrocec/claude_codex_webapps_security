'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcryptjs');

const db = require('./db');

const app = express();
const PORT = process.env.PORT || 5084;

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    store: new SQLiteStore({ db: 'sessions.sqlite', dir: __dirname }),
    secret: process.env.SESSION_SECRET || 'change-me-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 }, // 1 day
  })
);

// Make the current user and a flash message available to every view.
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
});

function flash(req, type, message) {
  req.session.flash = { type, message };
}

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------
function requireLogin(req, res, next) {
  if (!req.session.user) {
    flash(req, 'error', 'Please log in to continue.');
    return res.redirect('/login');
  }
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.session.user || req.session.user.role !== role) {
      flash(req, 'error', `Only ${role}s can do that.`);
      return res.redirect('/');
    }
    next();
  };
}

// ---------------------------------------------------------------------------
// Prepared statements
// ---------------------------------------------------------------------------
const stmt = {
  createUser: db.prepare(
    'INSERT INTO users (username, password, role) VALUES (?, ?, ?)'
  ),
  findUserByName: db.prepare('SELECT * FROM users WHERE username = ?'),

  createEvent: db.prepare(
    `INSERT INTO events (name, description, event_date, total_tickets, organiser_id)
     VALUES (@name, @description, @event_date, @total_tickets, @organiser_id)`
  ),
  allEvents: db.prepare(
    `SELECT e.*, u.username AS organiser_name,
            (e.total_tickets - e.tickets_sold) AS available
     FROM events e JOIN users u ON u.id = e.organiser_id
     ORDER BY e.created_at DESC`
  ),
  eventsByOrganiser: db.prepare(
    `SELECT e.*, (e.total_tickets - e.tickets_sold) AS available
     FROM events e WHERE e.organiser_id = ? ORDER BY e.created_at DESC`
  ),
  getEvent: db.prepare('SELECT * FROM events WHERE id = ?'),

  // Oversell-safe decrement: only succeeds if a ticket is still available.
  sellTicket: db.prepare(
    `UPDATE events SET tickets_sold = tickets_sold + 1
     WHERE id = ? AND tickets_sold < total_tickets`
  ),
  insertTicket: db.prepare(
    'INSERT INTO tickets (event_id, user_id) VALUES (?, ?)'
  ),

  ticketsByUser: db.prepare(
    `SELECT t.id, t.purchased_at, e.name AS event_name,
            e.event_date, e.description
     FROM tickets t JOIN events e ON e.id = t.event_id
     WHERE t.user_id = ? ORDER BY t.purchased_at DESC`
  ),
};

// Wrap the two-step purchase in a transaction so the count and the ticket
// row are always consistent. The conditional UPDATE is what prevents
// overselling under concurrent requests.
const purchaseTicket = db.transaction((eventId, userId) => {
  const result = stmt.sellTicket.run(eventId, userId);
  if (result.changes === 0) {
    return { ok: false }; // sold out
  }
  stmt.insertTicket.run(eventId, userId);
  return { ok: true };
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.get('/', (req, res) => {
  res.render('index', { events: stmt.allEvents.all() });
});

// --- Auth ---
app.get('/register', (req, res) => res.render('register'));

app.post('/register', (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';
  const role = req.body.role === 'organiser' ? 'organiser' : 'user';

  if (!username || !password) {
    flash(req, 'error', 'Username and password are required.');
    return res.redirect('/register');
  }

  try {
    const hash = bcrypt.hashSync(password, 10);
    const info = stmt.createUser.run(username, hash, role);
    req.session.user = { id: info.lastInsertRowid, username, role };
    flash(req, 'success', `Welcome, ${username}!`);
    res.redirect('/');
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      flash(req, 'error', 'That username is already taken.');
      return res.redirect('/register');
    }
    throw err;
  }
});

app.get('/login', (req, res) => res.render('login'));

app.post('/login', (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';
  const user = stmt.findUserByName.get(username);

  if (!user || !bcrypt.compareSync(password, user.password)) {
    flash(req, 'error', 'Invalid username or password.');
    return res.redirect('/login');
  }

  req.session.user = { id: user.id, username: user.username, role: user.role };
  flash(req, 'success', `Welcome back, ${user.username}!`);
  res.redirect('/');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// --- Organiser: events ---
app.get('/events/new', requireRole('organiser'), (req, res) => {
  res.render('new-event');
});

app.post('/events', requireRole('organiser'), (req, res) => {
  const name = (req.body.name || '').trim();
  const total = parseInt(req.body.total_tickets, 10);

  if (!name || !Number.isInteger(total) || total < 1) {
    flash(req, 'error', 'Provide an event name and a ticket count of at least 1.');
    return res.redirect('/events/new');
  }

  stmt.createEvent.run({
    name,
    description: (req.body.description || '').trim(),
    event_date: (req.body.event_date || '').trim(),
    total_tickets: total,
    organiser_id: req.session.user.id,
  });
  flash(req, 'success', 'Event created.');
  res.redirect('/dashboard');
});

app.get('/dashboard', requireRole('organiser'), (req, res) => {
  res.render('dashboard', {
    events: stmt.eventsByOrganiser.all(req.session.user.id),
  });
});

// --- Users: buy & view tickets ---
app.post('/events/:id/buy', requireLogin, (req, res) => {
  const eventId = parseInt(req.params.id, 10);
  const event = stmt.getEvent.get(eventId);

  if (!event) {
    flash(req, 'error', 'Event not found.');
    return res.redirect('/');
  }

  const { ok } = purchaseTicket(eventId, req.session.user.id);
  if (ok) {
    flash(req, 'success', `Ticket purchased for "${event.name}".`);
  } else {
    flash(req, 'error', `Sorry, "${event.name}" is sold out.`);
  }
  res.redirect('/');
});

app.get('/my-tickets', requireLogin, (req, res) => {
  res.render('my-tickets', {
    tickets: stmt.ticketsByUser.all(req.session.user.id),
  });
});

// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Ticketing app running at http://localhost:${PORT}`);
});
