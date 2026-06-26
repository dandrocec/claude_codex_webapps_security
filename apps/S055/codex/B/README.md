# Secure Survey Builder

A Node.js/Express survey builder with local accounts, survey creation, public response links, and owner-only response tables backed by SQLite.

## Run locally on port 5055

```bash
npm install
cp .env.example .env
npm start
```

Open `http://localhost:5055`.

Set a long random `SESSION_SECRET` in `.env` before running. For HTTPS deployments, set `COOKIE_SECURE=true`; local HTTP development uses `COOKIE_SECURE=false` so the browser will send the session cookie on `localhost`.

## Security notes

The app uses bcrypt password hashing, parameterised SQLite queries, CSRF tokens on state-changing requests, input validation and sanitisation, EJS output escaping, owner checks for private resources, Helmet security headers, rate limiting, secure session cookie options, and generic error responses.
