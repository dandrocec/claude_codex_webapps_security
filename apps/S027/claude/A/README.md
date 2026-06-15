# To-Do App

A simple multi-user to-do application. Each user registers, logs in, and manages
their own private list of tasks — add, complete, edit, and delete. You only ever
see your own tasks.

## Stack

- **Node.js / Express** — web server and routing
- **EJS** — server-rendered views
- **SQLite** (`better-sqlite3`) — data storage (created automatically as `data.sqlite`)
- **express-session** + **bcryptjs** — authentication (hashed passwords, server-side sessions)

## Features

- Register / log in / log out
- Each task belongs to one user; every task query is scoped to the logged-in user
- Add, toggle complete, edit, and delete tasks
- Passwords stored as bcrypt hashes
- Sessions persisted in SQLite, so logins survive a server restart

## Requirements

- Node.js 18 or newer

## Run it locally

```bash
# 1. Install dependencies
npm install

# 2. Start the server (listens on port 5027)
npm start
```

Then open **http://localhost:5027** in your browser.

Register a new account, log in, and start adding tasks. Create a second account
in a private window to confirm that each user sees only their own list.

### Notes

- The SQLite database files (`data.sqlite`, `sessions.sqlite`) are created in the
  project folder on first run. Delete them to start from a clean slate.
- To change the port, set the `PORT` environment variable, e.g. on Windows
  PowerShell: `$env:PORT=8080; npm start`.
- For production, set a strong `SESSION_SECRET` environment variable.

## Project layout

```
server.js          Express app, routes, and auth
db.js              SQLite connection and schema
views/             EJS templates (login, register, tasks + partials)
public/style.css   Styling
package.json       Dependencies and scripts
```
