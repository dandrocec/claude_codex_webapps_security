# Pollr — Express Polling App

A small polling web app built with **Node.js + Express + SQLite**.

- Registered users can **create polls** with a question and two or more options.
- **Anyone** (logged in or not) can **vote once per poll** — one vote is enforced per browser session.
- **Live results** are shown as a horizontal **bar chart** (Chart.js) that refreshes every few seconds.
- Polls and votes are persisted in a local SQLite database (`polls.db`).

## Requirements

- Node.js 18 or newer (includes npm)

## Run it locally

```bash
# 1. Install dependencies
npm install

# 2. Start the server (listens on port 5043)
npm start
```

Then open **http://localhost:5043** in your browser.

> The app listens on port **5043** by default. To use a different port:
> `PORT=8080 npm start` (macOS/Linux) or `set PORT=8080 && npm start` (Windows cmd)
> / `$env:PORT=8080; npm start` (Windows PowerShell).

## How to use

1. Click **Register** and create an account.
2. Click **New poll**, enter a question and at least two options (use *“+ Add another option”* for more), then **Create poll**.
3. Open the poll, cast a vote, and watch the bar chart update live. Share the poll URL so others can vote.

## Project layout

```
server.js          Express app: routes, auth, voting
db.js              SQLite connection + schema
views/             EJS templates (pages + header/footer partials)
public/style.css   Styles
polls.db           SQLite database (created automatically on first run)
```

## How things work

- **Auth**: passwords are hashed with bcrypt; login state is kept in an Express session cookie.
- **One vote per poll**: each visitor gets a random voter id stored in their session. The `votes` table has a `UNIQUE (poll_id, voter)` constraint, so a second vote attempt is silently ignored.
- **Live results**: the poll page polls `GET /polls/:id/results.json` every 3 seconds and updates the Chart.js bar chart.

## Notes

- Sessions are stored in memory, so restarting the server lets a browser vote again — fine for local/demo use. For production, swap in a persistent session store and set a real `SESSION_SECRET` (and `cookie.secure` behind HTTPS).
- Delete `polls.db` (and the `-wal`/`-shm` files) to reset all data.
