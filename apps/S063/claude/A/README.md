# mini-social

A small social app built with **Node.js + Express**. Users can:

- **Register** an account and **log in / out** (passwords hashed with bcrypt).
- **Set up a profile** (display name + bio).
- **Follow / unfollow** other users.
- **Post** short status updates (max 280 characters).
- View a **feed** of posts from people they follow (plus their own).

Data is stored in a local **SQLite** database (created automatically on first run — no database server to install).

## Tech stack

| Concern        | Choice                                  |
| -------------- | --------------------------------------- |
| Server         | Express 4                               |
| Views          | EJS templates                           |
| Database       | SQLite via `better-sqlite3`             |
| Sessions       | `express-session` + `connect-sqlite3`   |
| Password hash  | `bcryptjs`                              |

## Requirements

- **Node.js 18+** (developed on Node 24). npm comes bundled with Node.

## Run it locally (port 5063)

From the project directory:

```bash
npm install
npm start
```

Then open **http://localhost:5063** in your browser.

The app listens on port **5063** by default. To use a different port:

```bash
# macOS / Linux
PORT=8080 npm start

# Windows (PowerShell)
$env:PORT=8080; npm start
```

## Try it out

1. Open http://localhost:5063 — you'll be sent to the login page.
2. Click **Register**, create an account (e.g. `alice`), and set up your profile.
3. Register a **second** account in a private/incognito window (e.g. `bob`) and post something.
4. As `alice`, go to **People**, follow `bob`, and check your **Feed** — `bob`'s posts appear.

## Project layout

```
.
├── server.js          # Express app: routes, auth, sessions
├── db.js              # SQLite connection + schema (users, posts, follows)
├── package.json
├── public/
│   └── style.css
└── views/             # EJS templates
    ├── partials/      # shared header / footer
    ├── register.ejs
    ├── login.ejs
    ├── profile_edit.ejs
    ├── profile.ejs
    ├── feed.ejs
    ├── people.ejs
    └── not_found.ejs
```

## Notes

- The SQLite database file (`data.sqlite`) and session store (`sessions.sqlite`) are created
  in the project directory on first run and are git-ignored. Delete them to reset all data.
- For a real deployment, set a strong `SESSION_SECRET` environment variable and serve over HTTPS.

## Available scripts

- `npm start` — run the server.
- `npm run dev` — run with Node's built-in `--watch` (auto-restart on file changes).
