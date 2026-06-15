# Job Board

A simple job board built with Node.js, Express, and SQLite. Registered users can
post job listings; anyone can browse and search them; posters can edit and delete
their own listings.

## Features

- **User accounts** — register / log in / log out (passwords hashed with bcrypt,
  sessions stored in SQLite).
- **Post listings** — logged-in users add jobs with a title, company, location,
  and description.
- **Browse & search** — every listing is public and searchable by keyword
  (matches title, company, location, or description).
- **Owner controls** — a poster can edit or delete only their own listings.
- **Persistent storage** — all data is kept in a local SQLite database file.

## Requirements

- Node.js 18 or newer (includes npm).

## Run it locally (port 5038)

```bash
# 1. Install dependencies
npm install

# 2. Start the server
npm start
```

Then open **http://localhost:5038** in your browser.

The app listens on port **5038** by default. To use a different port:

```bash
PORT=8080 npm start        # macOS / Linux
$env:PORT=8080; npm start  # Windows PowerShell
```

## First steps

1. Click **Register** and create an account.
2. Click **Post a job** to publish a listing.
3. Use the search box on the home page to filter listings by keyword.
4. Open one of your own listings to **Edit** or **Delete** it.

## Project layout

```
server.js            Express app: routes, auth, search
db.js                SQLite connection + schema
views/               EJS templates (pages + header/footer partials)
public/style.css     Styles
package.json         Dependencies and scripts
```

## Notes

- The SQLite database (`data.sqlite`) and session store (`sessions.sqlite`) are
  created automatically on first run; they are git-ignored.
- For production, set a strong `SESSION_SECRET` environment variable.
```bash
SESSION_SECRET="a-long-random-string" npm start
```
