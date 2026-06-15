# Habit Tracker

A small Node.js / Express app where users register, log in, define daily habits,
tick them off each day, and see a running **streak** (consecutive days) per habit.
Data is stored in a local **SQLite** database — no external database server needed.

## Features

- User accounts with hashed passwords (bcrypt) and server-side sessions
- Add / delete daily habits
- One-click toggle to mark a habit done (or undo it) for today
- Current streak 🔥 and total-days count per habit
- Each user only sees and edits their own habits

## Tech

- **Express** + **EJS** views
- **better-sqlite3** for storage (auto-creates `data.sqlite` on first run)
- **express-session** with a SQLite-backed session store

## Requirements

- Node.js **18 or newer** (tested on Node 24)
- npm

## Run it locally (port 5035)

```bash
npm install
npm start
```

Then open <http://localhost:5035> in your browser.

Register an account, add a few habits, and tick them off. The app listens on
port **5035** by default. To use a different port:

```bash
# macOS / Linux
PORT=8080 npm start

# Windows (PowerShell)
$env:PORT=8080; npm start
```

## Notes

- The SQLite files (`data.sqlite`, `sessions.sqlite`) are created next to
  `server.js` on first run and are git-ignored.
- A "streak" counts consecutive days up to today. If you haven't ticked the
  habit yet today, the streak still counts as long as yesterday was done; it
  resets to 0 once a day is missed.
- For production, set a real session secret via the `SESSION_SECRET`
  environment variable.

## Project layout

```
server.js        Express app, routes, streak logic
db.js            SQLite connection + schema
views/           EJS templates (index, login, register, layout partials)
public/style.css Styling
```
