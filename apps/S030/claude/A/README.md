# Bookmark Manager

A small multi-user bookmark manager built with **Node.js**, **Express**, **EJS**, and **SQLite**.

Each user registers an account, then can:

- **Save** links (title, URL, comma-separated tags)
- **Edit** and **delete** their own bookmarks
- **View** their own list, **filtered by tag**

All bookmarks are private — users only ever see and modify their own. Passwords are hashed with bcrypt and sessions keep users logged in.

## Requirements

- Node.js **18 or newer** (includes npm)

Data is stored in a local SQLite file (`data.sqlite`), created automatically on first run. No separate database server is needed.

## Run it locally (port 5030)

```bash
# 1. Install dependencies
npm install

# 2. Start the server
npm start
```

Then open <http://localhost:5030> in your browser.

> The app listens on port **5030** by default. To use a different port, set the
> `PORT` environment variable, e.g. `PORT=3000 npm start` (PowerShell:
> `$env:PORT=3000; npm start`).

## First steps

1. Go to <http://localhost:5030> — you'll be redirected to the login page.
2. Click **Register** and create an account (username ≥ 3 chars, password ≥ 6 chars).
3. Add a bookmark with **+ New bookmark**.
4. Click any tag chip to filter your list by that tag; click **All** to clear.

## Project layout

```
.
├── server.js          # Express app: routes, auth, sessions
├── db.js              # SQLite connection + schema (auto-created)
├── package.json       # Dependency manifest
├── views/             # EJS templates
│   ├── partials/      # Shared header/footer
│   ├── index.ejs      # Bookmark list + tag filter
│   ├── form.ejs       # Create/edit form
│   ├── login.ejs
│   └── register.ejs
└── public/css/style.css
```

## Notes

- For production use, set a strong `SESSION_SECRET` environment variable.
- To reset all data, stop the server and delete `data.sqlite` (and the
  `data.sqlite-wal` / `data.sqlite-shm` files if present).
