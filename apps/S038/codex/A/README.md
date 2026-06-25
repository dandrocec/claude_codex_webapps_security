# Express Job Board

A Node.js/Express job board where users can register, log in, post listings, browse all jobs, search by keyword, and edit or delete their own listings. Data is stored in SQLite database files created automatically on first run.

## Run locally

```bash
npm install
npm start
```

The app runs on port `5038` by default:

```text
http://localhost:5038
```

Optional environment variables:

- `PORT` changes the listening port.
- `SESSION_SECRET` sets the session signing secret.
- `DATABASE_URL` sets the SQLite database file path.
