# Express Habit Tracker

A small Node.js/Express habit tracker with user accounts, daily habits, one-click daily checkoffs, and simple streak counts per habit. Data is stored in a local SQLite database at `data/habits.db`.

## Run locally

Install dependencies:

```bash
npm install
```

Start the app on port 5035:

```bash
npm start
```

Open `http://localhost:5035` in your browser.

Optional environment variables:

- `PORT` changes the listening port. The default is `5035`.
- `SESSION_SECRET` sets the session signing secret.
- `DATABASE_URL` sets a custom SQLite database file path.
