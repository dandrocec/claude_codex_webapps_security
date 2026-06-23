# Mini CRM

A small sales CRM built with **Node.js + Express**. Sales reps manage **contacts**
and **deals**, and move deals through pipeline stages on a **kanban board**.

- **Sales** users see only the contacts and deals they own.
- **Managers** see the whole team's contacts and deals (with an owner column).

Data is stored in a local **SQLite** database via Node's built-in `node:sqlite`
module — so there is **no native module to compile** and no external database to
install.

## Requirements

- **Node.js >= 22.5** (built-in `node:sqlite`). Developed/tested on Node 24.
  Check with `node --version`.

## Run it locally (port 5078)

```bash
# 1. install dependencies
npm install

# 2. start the server (creates + seeds crm.db automatically on first run)
npm start
```

Then open <http://localhost:5078>.

The first start creates `crm.db` and seeds demo data automatically. If you ever
want to (re)seed manually, run `npm run seed`. To start completely fresh, delete
`crm.db` and start again.

### Demo logins

All demo accounts use the password **`password`**:

| Email                 | Role    | Sees                       |
| --------------------- | ------- | -------------------------- |
| `manager@example.com` | manager | the whole team's data      |
| `alice@example.com`   | sales   | only Alice's contacts/deals|
| `bob@example.com`     | sales   | only Bob's contacts/deals  |

(The login form is pre-filled with Alice's credentials for convenience.)

## What you can do

- **Board** (`/board`) — pipeline kanban grouped by stage
  (`lead → qualified → proposal → negotiation → won → lost`). Each card shows the
  deal value and lets you move it back/forward a stage with the ◀ / ▶ buttons.
  Column headers show the deal count and total value.
- **Deals** (`/deals`) — list / create / edit / delete deals, each optionally
  linked to a contact.
- **Contacts** (`/contacts`) — list / create / edit / delete contacts.

Log in as the **manager** to see everyone's data (an extra *Owner* column
appears); log in as a **sales** user to see a scoped view of just your own.

## Configuration (optional)

Environment variables:

| Variable         | Default                      | Purpose                          |
| ---------------- | ---------------------------- | -------------------------------- |
| `PORT`           | `5078`                       | HTTP port                        |
| `DB_PATH`        | `./crm.db`                   | SQLite file location             |
| `SESSION_SECRET` | `dev-only-secret-change-me`  | session signing secret           |

## Project layout

```
server.js            Express app: auth, routes, ownership rules
db.js                SQLite connection + schema + stage list
seed.js              Demo users / contacts / deals (auto-run on first start)
views/               EJS templates (board, contacts, deals, login)
public/style.css     Styling
```

## How ownership works

Each contact and deal has an `owner_id`. Every list query is scoped to the
current user unless they are a `manager`, and every edit/delete/stage-change
checks `canAccess()` (owner **or** manager) before touching a row — so a sales
user cannot view or modify another rep's records by guessing IDs.

## Notes

This is a demo app: sessions are stored in memory and the session secret has a
dev default. For production you'd add a persistent session store, set a real
`SESSION_SECRET`, and serve over HTTPS.
