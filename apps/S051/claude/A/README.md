# 🎬 Movie Watchlist

A personal movie watchlist built with **Node.js, Express, and SQLite**. Each user
registers and logs in, adds movies (title, year, status, personal rating), and
filters their list by status.

## Features

- User registration & login (passwords hashed with bcrypt, sessions stored in SQLite)
- Add movies with **title**, **year**, **status** (To Watch / Watching / Watched), and a **rating** (1–10)
- Filter the list by status
- Delete movies
- Each user only sees their own list
- Data persisted in a local SQLite database (no external DB server needed)

## Requirements

- Node.js 18 or newer (includes npm)

## Run it locally (port 5051)

```bash
# 1. Install dependencies
npm install

# 2. Start the server
npm start
```

Then open <http://localhost:5051> in your browser.

You'll land on the login page — click **Register here** to create an account,
then start adding movies.

> The app listens on port **5051** by default. To use a different port:
> `PORT=8080 npm start` (or set the `PORT` environment variable on Windows).

## Project structure

```
.
├── server.js            # Express app: routes, auth, sessions
├── db.js                # SQLite connection + schema
├── views/               # EJS templates
│   ├── partials/        # shared header & footer
│   ├── index.ejs        # watchlist + add form + filters
│   ├── login.ejs
│   └── register.ejs
├── public/style.css     # styling
├── package.json
└── README.md
```

## Notes

- The SQLite database files (`watchlist.db`, `sessions.db`) are created
  automatically on first run and are git-ignored.
- For production, set a strong `SESSION_SECRET` environment variable.
