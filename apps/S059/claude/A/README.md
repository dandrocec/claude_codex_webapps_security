# Room Reservation System

A small Node.js / Express web app for booking meeting rooms. Logged-in users see
per-day availability across all rooms and time slots, book a free slot, and view
or cancel their own bookings. Double-booking the same room/day/slot is prevented
at the database level.

## Features

- **Authentication** — register / log in / log out (sessions, bcrypt-hashed passwords).
- **Daily availability grid** — pick a date and see every room × time-slot as
  *Free*, *Yours*, or *Taken*.
- **One-click booking** of any free slot.
- **Double-booking prevention** — a `UNIQUE(room_id, date, slot)` constraint makes
  it impossible for two bookings to occupy the same room/day/slot, even under
  concurrent requests.
- **My Bookings** — list and cancel your own reservations (you can only cancel
  bookings you own).
- **Database storage** — SQLite (via `better-sqlite3`); the schema, seed rooms,
  and a demo user are created automatically on first run.

## Tech stack

Node.js · Express · EJS templates · SQLite (`better-sqlite3`) · `express-session`.

## Requirements

- Node.js 18 or newer (includes `npm`).
- No external database server needed — SQLite files are created in the project
  directory automatically.

> `better-sqlite3` is a native module. On most systems `npm install` fetches a
> prebuilt binary. If it has to compile, you'll need standard build tools
> (e.g. Xcode CLT on macOS, `build-essential` + Python on Linux, or the
> "Desktop development with C++" workload / windows-build-tools on Windows).

## Run it locally (port 5059)

```bash
# 1. Install dependencies
npm install

# 2. Start the server
npm start
```

Then open <http://localhost:5059> in your browser.

The app listens on port **5059** by default. To use a different port:

```bash
# macOS / Linux
PORT=8080 npm start

# Windows (PowerShell)
$env:PORT=8080; npm start
```

## Demo login

A demo account is seeded on first launch:

- **Username:** `demo`
- **Password:** `password123`

You can also create your own account via the **Register** page.

## How double-booking is prevented

Bookings are stored in a table with:

```sql
UNIQUE (room_id, date, slot)
```

When two users try to grab the same room/day/slot, the database rejects the
second `INSERT` with a uniqueness violation, which the app catches and reports as
*"That slot was just taken."* This guarantees correctness even if two requests
arrive at the same instant — the constraint, not application code, is the source
of truth.

## Project layout

```
.
├── server.js            # Express app: routes, auth, booking logic
├── db.js                # SQLite connection, schema, seed data
├── package.json         # Dependencies and start scripts
├── views/               # EJS templates (login, register, availability, bookings)
│   └── partials/        # Shared header/footer
├── public/style.css     # Styling
└── README.md
```

## Notes

- Session and application data are stored in SQLite files (`data.sqlite`,
  `sessions.sqlite`) created in the project root; they're git-ignored.
- For production you would set a real `SESSION_SECRET` environment variable and
  serve over HTTPS.
