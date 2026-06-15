# FAQ App

A small **Node.js / Express** application for managing a list of frequently asked
questions.

- **Public page** (`/`) — displays all Q&A pairs grouped by category, with a
  keyword filter that searches questions, answers, and category names.
- **Editor admin panel** (`/admin`) — a logged-in editor can add, edit, delete,
  and reorder (move up/down) question-and-answer pairs. New categories are
  created simply by typing a new category name.
- **Storage** — data is persisted in a local **SQLite** database (via
  `better-sqlite3`). Sessions are also stored in SQLite.

## Requirements

- Node.js 18 or newer (includes npm)

> `better-sqlite3` is a native module and is compiled during `npm install`.
> On Windows this needs the standard build tools that ship with a normal
> Node.js installation; no extra setup is usually required.

## Run it locally (port 5041)

```bash
# 1. Install dependencies
npm install

# 2. (Optional) configure environment
cp .env.example .env      # then edit values if you like

# 3. Start the server
npm start
```

Then open <http://localhost:5041>.

The app listens on port **5041** by default. You can override it with the `PORT`
environment variable (or in `.env`).

## Logging in as the editor

On first run, an editor account and a few sample FAQs are seeded automatically.

Default credentials (override via `.env` **before** the first run):

| Username | Password   |
| -------- | ---------- |
| `editor` | `changeme` |

Go to **Editor login** (top-right) → sign in → you'll land on `/admin`.

> The editor account is only seeded if it doesn't already exist. To change the
> credentials after the database has been created, delete the `data/` folder
> (this also clears all FAQs) and restart, or update the `users` table directly.

## Project layout

```
server.js            Express app: routes, sessions, auth
db.js                SQLite setup, schema, seed data, query helpers
views/               EJS templates
  public.ejs         Public categorized + filterable FAQ page
  login.ejs          Editor login form
  admin.ejs          Editor dashboard (CRUD + ordering)
  partials/          Shared header/footer
public/styles.css    Styling
data/                SQLite database files (created at runtime)
```

## How ordering works

Each FAQ has a `position` within its category. The **↑ / ↓** buttons in the
admin panel swap an item with its neighbour in the same category. The public
page and admin list both render items ordered by `(category, position)`.
