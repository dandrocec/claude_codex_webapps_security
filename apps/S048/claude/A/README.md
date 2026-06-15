# Feedback Portal

A small Node.js / Express app where:

- **Visitors** submit feedback (category, 1–5 rating, comment) — no login needed.
- A **logged-in reviewer** sees every piece of feedback in a sortable table.

Data is stored in a local **SQLite** database (via `better-sqlite3`). Sessions are
also persisted to SQLite, so a restart won't log the reviewer out.

## Requirements

- Node.js 18 or newer (includes npm)

## Run it locally

```bash
# 1. Install dependencies
npm install

# 2. (optional) configure credentials / secret
cp .env.example .env      # then edit as you like

# 3. Start the server
npm start
```

Then open <http://localhost:5048>.

The app listens on **port 5048** by default. To use a different port, set `PORT`
(e.g. `PORT=8080 npm start`, or via `.env`).

## Reviewer login

Default credentials (override in `.env`):

| Username   | Password      |
| ---------- | ------------- |
| `reviewer` | `reviewer123` |

Log in at <http://localhost:5048/login>, then visit **Reviews** to see all
feedback. Click the **Category**, **Rating**, or **Submitted** column headers to
sort; click again to flip the direction.

## How it works

| Route             | Method | Access   | Purpose                          |
| ----------------- | ------ | -------- | -------------------------------- |
| `/`               | GET    | public   | Feedback submission form         |
| `/feedback`       | POST   | public   | Validate + store feedback        |
| `/login`          | GET    | public   | Reviewer login form              |
| `/login`          | POST   | public   | Authenticate the reviewer        |
| `/logout`         | POST   | reviewer | End the session                  |
| `/reviews`        | GET    | reviewer | Sortable list of all feedback    |

- Input is validated server-side (valid category, integer rating 1–5, non-empty comment).
- All SQL uses prepared statements; the sort column/direction are whitelisted to
  prevent SQL injection.
- EJS auto-escapes user-supplied text, so comments render safely.

## Project layout

```
server.js          Express app, routes, auth
db.js              SQLite connection + schema
views/             EJS templates (submit, login, reviews + partials)
public/style.css   Styling
data/              SQLite files (created on first run; git-ignored)
```

## Resetting the data

Stop the server and delete the `data/` folder. It will be recreated empty on the
next start.
