# Personal Expense Tracker

A Node.js/Express app for tracking personal expenses with user registration, login, expense create/edit/delete flows, SQLite storage, and monthly totals.

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:5032`.

The app stores SQLite database files in the local `data/` directory. Set `SESSION_SECRET` in your environment for a stronger session secret outside local development.
