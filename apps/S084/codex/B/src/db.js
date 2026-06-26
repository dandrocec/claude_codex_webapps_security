const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const dataDir = path.join(__dirname, "..", "data");
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, "ticketing.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organiser_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ticket_limit INTEGER NOT NULL CHECK (ticket_limit > 0),
  sold_count INTEGER NOT NULL DEFAULT 0 CHECK (sold_count >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (organiser_id) REFERENCES users(id) ON DELETE CASCADE,
  CHECK (sold_count <= ticket_limit)
);

CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  ticket_code TEXT NOT NULL UNIQUE,
  purchased_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_events_starts_at ON events(starts_at);
CREATE INDEX IF NOT EXISTS idx_tickets_user_id ON tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_event_id ON tickets(event_id);
`);

const statements = {
  createUser: db.prepare("INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)"),
  getUserByEmail: db.prepare("SELECT id, name, email, password_hash FROM users WHERE email = ?"),
  createEvent: db.prepare(`
    INSERT INTO events (organiser_id, title, description, starts_at, ticket_limit)
    VALUES (?, ?, ?, ?, ?)
  `),
  listEvents: db.prepare(`
    SELECT e.id, e.title, e.description, e.starts_at, e.ticket_limit, e.sold_count,
           u.name AS organiser_name
    FROM events e
    JOIN users u ON u.id = e.organiser_id
    ORDER BY datetime(e.starts_at) ASC, e.id ASC
  `),
  getEvent: db.prepare(`
    SELECT e.id, e.organiser_id, e.title, e.description, e.starts_at, e.ticket_limit, e.sold_count,
           u.name AS organiser_name
    FROM events e
    JOIN users u ON u.id = e.organiser_id
    WHERE e.id = ?
  `),
  incrementIfAvailable: db.prepare(`
    UPDATE events
    SET sold_count = sold_count + 1
    WHERE id = ? AND sold_count < ticket_limit
  `),
  insertTicket: db.prepare("INSERT INTO tickets (event_id, user_id, ticket_code) VALUES (?, ?, ?)"),
  listTicketsForUser: db.prepare(`
    SELECT t.id, t.ticket_code, t.purchased_at,
           e.id AS event_id, e.title, e.starts_at, e.organiser_id
    FROM tickets t
    JOIN events e ON e.id = t.event_id
    WHERE t.user_id = ?
    ORDER BY datetime(t.purchased_at) DESC, t.id DESC
  `)
};

const buyTicketTransaction = db.transaction((eventId, userId, ticketCode) => {
  const event = statements.getEvent.get(eventId);
  if (!event) return { ok: false, reason: "not_found" };

  const update = statements.incrementIfAvailable.run(eventId);
  if (update.changes !== 1) return { ok: false, reason: "sold_out" };

  const ticket = statements.insertTicket.run(eventId, userId, ticketCode);
  return { ok: true, ticketId: ticket.lastInsertRowid };
});

module.exports = {
  createUser(name, email, passwordHash) {
    return statements.createUser.run(name, email, passwordHash).lastInsertRowid;
  },
  getUserByEmail(email) {
    return statements.getUserByEmail.get(email);
  },
  createEvent({ organiserId, title, description, startsAt, ticketLimit }) {
    return statements.createEvent.run(organiserId, title, description, startsAt, ticketLimit).lastInsertRowid;
  },
  listEvents() {
    return statements.listEvents.all();
  },
  getEvent(id) {
    return statements.getEvent.get(id);
  },
  buyTicket(eventId, userId, ticketCode) {
    return buyTicketTransaction(eventId, userId, ticketCode);
  },
  listTicketsForUser(userId) {
    return statements.listTicketsForUser.all(userId);
  }
};
