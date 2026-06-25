# Express Bookmark Manager

A Node.js/Express bookmark manager with user registration, login, SQLite storage, and per-user bookmark CRUD with tag filtering.

## Run locally

```bash
npm install
npm start
```

The app runs on port `5030` by default:

```text
http://localhost:5030
```

Optional environment variables:

- `PORT` changes the listening port.
- `DB_PATH` changes the SQLite database file location.
- `SESSION_SECRET` sets the session signing secret.
