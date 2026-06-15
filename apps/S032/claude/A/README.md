# Expense Tracker

A personal expense tracker built with **Node.js + Express**, server-rendered with **EJS**,
and backed by a **SQLite** database. Each user logs in and records expenses (amount,
category, date, note), edits or deletes them, and sees a running monthly total.

## Features

- User registration & login (passwords hashed with bcrypt, sessions stored in SQLite)
- Add, edit, and delete expenses — each scoped to the logged-in user
- Monthly total with a month picker to browse past months
- Zero external services required — the database is a local file created on first run

## Requirements

- Node.js 18 or newer (includes npm)

## Run it locally

```bash
# 1. Install dependencies
npm install

# 2. (optional) configure environment
cp .env.example .env        # Windows: copy .env.example .env
#    edit .env to set a SESSION_SECRET; PORT defaults to 5032

# 3. Start the server
npm start
```

Then open **http://localhost:5032** in your browser, create an account, and start
logging expenses.

> The app listens on port **5032** by default. To use a different port, set `PORT`
> in `.env` or run `PORT=xxxx npm start` (PowerShell: `$env:PORT=xxxx; npm start`).

## Project layout

```
server.js            Express app, routes, validation
db.js                SQLite connection + schema (auto-created)
auth.js              Password hashing helpers (bcrypt)
views/               EJS templates (login, register, expenses, edit)
public/style.css     Styling
data/                SQLite database files (created at runtime, git-ignored)
```

## Notes

- The SQLite database lives at `data/expenses.db` and is created automatically on
  first run; no migrations to run.
- For production use, set a strong `SESSION_SECRET` and serve behind HTTPS.
