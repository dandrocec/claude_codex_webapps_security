# Secure Express Job Board

A Node.js/Express job board where users can register, log in, post listings, search listings, and edit or delete only their own posts. Data is stored in SQLite.

## Run locally on port 5038

```bash
npm install
SESSION_SECRET="replace-with-a-long-random-secret" COOKIE_SECURE=false npm start
```

Open `http://localhost:5038`.

## Environment variables

- `SESSION_SECRET` is required and must be a long random value.
- `PORT` defaults to `5038`.
- `DATABASE_FILE` defaults to `data/jobboard.sqlite`.
- `COOKIE_SECURE` defaults to secure cookies unless set to `false` for local HTTP development.

The app uses bcrypt password hashing, parameterised SQLite queries, CSRF tokens, validation and sanitisation, ownership checks, secure headers, and generic error responses.
