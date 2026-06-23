# 🎟️ Ticketing App

A small event-ticketing web app built with **Node.js + Express**, server-rendered
with **EJS**, and backed by a **SQLite** database (via `better-sqlite3`).

- **Organisers** register, create events with a fixed number of tickets, and watch
  sales on a dashboard.
- **Users** register, browse events, and buy tickets until an event sells out.
- **Overselling is prevented** at both the application and database level.
- Users can view all the tickets they have purchased.

## Requirements

- Node.js **18+** and npm

> `better-sqlite3` is a native module. npm installs a prebuilt binary for common
> platforms; if none is available it compiles from source, which needs standard
> build tools (on Windows these come with the official Node.js installer).

## Run it locally (port 5084)

```bash
npm install
npm start
```

Then open **http://localhost:5084**.

The SQLite database (`data.sqlite`) and session store (`sessions.sqlite`) are
created automatically in the project folder on first run.

To use a different port:

```bash
# macOS/Linux
PORT=5084 npm start
# Windows PowerShell
$env:PORT=5084; npm start
```

(The app already defaults to **5084**, so plain `npm start` is enough.)

## Try it

1. Open http://localhost:5084 and **Register** as an *Organiser*.
2. Create an event with, say, **2** tickets.
3. Log out, **Register** as a *User*, and buy tickets from the home page.
4. After 2 purchases the event shows **SOLD OUT** and further buys are rejected.
5. Visit **My Tickets** to see your purchases.

## How overselling is prevented

Buying a ticket is a single atomic transaction (`server.js`):

```sql
UPDATE events SET tickets_sold = tickets_sold + 1
WHERE id = ? AND tickets_sold < total_tickets;
```

The `WHERE tickets_sold < total_tickets` guard means the update affects **zero
rows** once the event is full, so the purchase is rejected instead of overselling.
The `UPDATE` and the matching `INSERT` into `tickets` run inside one
`better-sqlite3` transaction, and the `events` table also carries a
`CHECK (tickets_sold <= total_tickets)` constraint as a final database-level
safety net.

## Project layout

```
server.js            Express app, routes, purchase transaction
db.js                SQLite connection + schema
views/               EJS templates
public/style.css     Styling
package.json         Dependencies & scripts
```

## Tech / dependencies

- `express` — web framework
- `ejs` — server-side templates
- `better-sqlite3` — embedded SQL database
- `express-session` + `connect-sqlite3` — sessions
- `bcryptjs` — password hashing
