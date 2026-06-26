const express = require("express");
const session = require("express-session");
const sqlite3 = require("sqlite3").verbose();
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 5084);
const DATA_DIR = path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "tickets.sqlite");

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new sqlite3.Database(DB_PATH);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) {
        reject(error);
        return;
      }
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(rows);
    });
  });
}

async function initDatabase() {
  await run("PRAGMA journal_mode = WAL");
  await run("PRAGMA foreign_keys = ON");

  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      venue TEXT NOT NULL,
      event_date TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      total_tickets INTEGER NOT NULL CHECK (total_tickets > 0),
      tickets_sold INTEGER NOT NULL DEFAULT 0 CHECK (tickets_sold >= 0),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (tickets_sold <= total_tickets)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      event_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      purchased_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    )
  `);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function layout({ title, body, user, notice = "", error = "" }) {
  const currentUser = user
    ? `<span class="user-pill">Viewing as ${escapeHtml(user)}</span>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} | Ticket Desk</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <header class="topbar">
    <a class="brand" href="/">Ticket Desk</a>
    <nav>
      <a href="/">Events</a>
      <a href="/events/new">Create event</a>
      <a href="/my-tickets">My tickets</a>
    </nav>
    ${currentUser}
  </header>
  <main class="page">
    ${notice ? `<div class="alert success">${escapeHtml(notice)}</div>` : ""}
    ${error ? `<div class="alert error">${escapeHtml(error)}</div>` : ""}
    ${body}
  </main>
</body>
</html>`;
}

function redirectWithMessage(res, pathName, params) {
  const query = new URLSearchParams(params).toString();
  res.redirect(query ? `${pathName}?${query}` : pathName);
}

async function findOrCreateUser(username) {
  const normalized = username.trim();
  let user = await get("SELECT id, username FROM users WHERE username = ?", [normalized]);
  if (user) {
    return user;
  }

  try {
    const result = await run("INSERT INTO users (username) VALUES (?)", [normalized]);
    return { id: result.lastID, username: normalized };
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT") {
      user = await get("SELECT id, username FROM users WHERE username = ?", [normalized]);
      if (user) {
        return user;
      }
    }
    throw error;
  }
}

const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "local-ticketing-secret",
    resave: false,
    saveUninitialized: false
  })
);

app.get("/", async (req, res, next) => {
  try {
    const events = await all(`
      SELECT id, title, venue, event_date, description, total_tickets, tickets_sold,
             total_tickets - tickets_sold AS tickets_left
      FROM events
      ORDER BY datetime(event_date) ASC, id ASC
    `);

    const eventCards = events.length
      ? events
          .map((event) => {
            const soldOut = event.tickets_left <= 0;
            const buyControls = soldOut
              ? `<div class="sold-out">Sold out</div>`
              : `<form class="buy-form" method="post" action="/events/${event.id}/buy">
                  <label>
                    Username
                    <input name="username" value="${escapeHtml(req.session.username || "")}" required maxlength="60" autocomplete="username">
                  </label>
                  <label>
                    Tickets
                    <input name="quantity" type="number" min="1" max="${event.tickets_left}" value="1" required>
                  </label>
                  <button type="submit">Buy</button>
                </form>`;

            return `<article class="event-card">
              <div>
                <h2>${escapeHtml(event.title)}</h2>
                <p class="event-meta">${escapeHtml(event.venue)} · ${escapeHtml(event.event_date)}</p>
                <p>${escapeHtml(event.description)}</p>
              </div>
              <div class="availability">
                <strong>${event.tickets_left}</strong>
                <span>of ${event.total_tickets} left</span>
              </div>
              ${buyControls}
            </article>`;
          })
          .join("")
      : `<section class="empty-state">
          <h1>No events yet</h1>
          <p>Create the first event and start selling a limited ticket allocation.</p>
          <a class="button-link" href="/events/new">Create event</a>
        </section>`;

    res.send(
      layout({
        title: "Events",
        user: req.session.username,
        notice: req.query.notice,
        error: req.query.error,
        body: `<section class="page-heading">
          <h1>Events</h1>
          <a class="button-link" href="/events/new">Create event</a>
        </section>
        <section class="event-grid">${eventCards}</section>`
      })
    );
  } catch (error) {
    next(error);
  }
});

app.get("/events/new", (req, res) => {
  res.send(
    layout({
      title: "Create event",
      user: req.session.username,
      body: `<section class="form-panel">
        <h1>Create an event</h1>
        <form method="post" action="/events" class="stacked-form">
          <label>
            Title
            <input name="title" required maxlength="120">
          </label>
          <label>
            Venue
            <input name="venue" required maxlength="120">
          </label>
          <label>
            Date and time
            <input name="event_date" type="datetime-local" required>
          </label>
          <label>
            Total tickets
            <input name="total_tickets" type="number" min="1" max="100000" required>
          </label>
          <label>
            Description
            <textarea name="description" rows="5" maxlength="1000"></textarea>
          </label>
          <button type="submit">Create event</button>
        </form>
      </section>`
    })
  );
});

app.post("/events", async (req, res, next) => {
  try {
    const title = String(req.body.title || "").trim();
    const venue = String(req.body.venue || "").trim();
    const eventDate = String(req.body.event_date || "").trim();
    const description = String(req.body.description || "").trim();
    const totalTickets = Number.parseInt(req.body.total_tickets, 10);

    if (!title || !venue || !eventDate || !Number.isInteger(totalTickets) || totalTickets < 1) {
      redirectWithMessage(res, "/events/new", { error: "Please provide a valid title, venue, date, and ticket count." });
      return;
    }

    await run(
      `INSERT INTO events (title, venue, event_date, description, total_tickets)
       VALUES (?, ?, ?, ?, ?)`,
      [title, venue, eventDate, description, totalTickets]
    );

    redirectWithMessage(res, "/", { notice: "Event created." });
  } catch (error) {
    next(error);
  }
});

app.post("/events/:id/buy", async (req, res, next) => {
  const eventId = Number.parseInt(req.params.id, 10);
  const username = String(req.body.username || "").trim();
  const quantity = Number.parseInt(req.body.quantity, 10);

  if (!Number.isInteger(eventId) || !username || !Number.isInteger(quantity) || quantity < 1) {
    redirectWithMessage(res, "/", { error: "Enter a username and a valid ticket quantity." });
    return;
  }

  try {
    await run("BEGIN IMMEDIATE TRANSACTION");

    const event = await get("SELECT id FROM events WHERE id = ?", [eventId]);
    if (!event) {
      await run("ROLLBACK");
      redirectWithMessage(res, "/", { error: "Event not found." });
      return;
    }

    const user = await findOrCreateUser(username);

    const update = await run(
      `UPDATE events
       SET tickets_sold = tickets_sold + ?
       WHERE id = ?
         AND total_tickets - tickets_sold >= ?`,
      [quantity, eventId, quantity]
    );

    if (update.changes !== 1) {
      await run("ROLLBACK");
      redirectWithMessage(res, "/", { error: "Not enough tickets remain for that purchase." });
      return;
    }

    await run("INSERT INTO tickets (user_id, event_id, quantity) VALUES (?, ?, ?)", [user.id, eventId, quantity]);
    await run("COMMIT");

    req.session.username = user.username;
    redirectWithMessage(res, "/my-tickets", { notice: "Tickets purchased." });
  } catch (error) {
    try {
      await run("ROLLBACK");
    } catch (_) {
      // The transaction may already be closed.
    }
    next(error);
  }
});

app.get("/my-tickets", async (req, res, next) => {
  try {
    const requestedUser = String(req.query.username || req.session.username || "").trim();
    let tickets = [];
    let user = null;

    if (requestedUser) {
      user = await get("SELECT id, username FROM users WHERE username = ?", [requestedUser]);
      if (user) {
        tickets = await all(
          `SELECT t.id, t.quantity, t.purchased_at, e.title, e.venue, e.event_date
           FROM tickets t
           JOIN events e ON e.id = t.event_id
           WHERE t.user_id = ?
           ORDER BY datetime(t.purchased_at) DESC, t.id DESC`,
          [user.id]
        );
        req.session.username = user.username;
      }
    }

    const lookup = `<section class="form-panel compact">
      <h1>My tickets</h1>
      <form method="get" action="/my-tickets" class="inline-form">
        <label>
          Username
          <input name="username" value="${escapeHtml(requestedUser)}" required maxlength="60" autocomplete="username">
        </label>
        <button type="submit">View</button>
      </form>
    </section>`;

    const content = requestedUser
      ? tickets.length
        ? `<section class="ticket-list">
            ${tickets
              .map(
                (ticket) => `<article class="ticket">
                  <div>
                    <h2>${escapeHtml(ticket.title)}</h2>
                    <p>${escapeHtml(ticket.venue)} · ${escapeHtml(ticket.event_date)}</p>
                    <p>Purchased ${escapeHtml(ticket.purchased_at)}</p>
                  </div>
                  <strong>${ticket.quantity} ticket${ticket.quantity === 1 ? "" : "s"}</strong>
                </article>`
              )
              .join("")}
          </section>`
        : `<section class="empty-state"><p>No tickets found for ${escapeHtml(requestedUser)}.</p></section>`
      : `<section class="empty-state"><p>Enter the username used during purchase to see tickets.</p></section>`;

    res.send(
      layout({
        title: "My tickets",
        user: req.session.username,
        notice: req.query.notice,
        error: req.query.error,
        body: lookup + content
      })
    );
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, _next) => {
  console.error(error);
  res.status(500).send(
    layout({
      title: "Error",
      user: req.session?.username,
      error: "Something went wrong. Please try again.",
      body: `<section class="empty-state"><a class="button-link" href="/">Back to events</a></section>`
    })
  );
});

initDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Ticket Desk running at http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Failed to initialize database", error);
    process.exit(1);
  });
