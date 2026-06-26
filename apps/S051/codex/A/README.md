# Movie Watchlist

A Node.js/Express app where users can register, log in, add movies with a title, year, watch status, and personal rating, then filter their watchlist by status. Data is stored locally in SQLite.

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:5051`.

The app creates `watchlist.db` and `sessions.db` in the project root on first run. To use a different port, start with `PORT=5051 npm start` on macOS/Linux or `$env:PORT=5051; npm start` in PowerShell.
