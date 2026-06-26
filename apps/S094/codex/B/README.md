# Secure Integration Hub

A Node.js/Express app for registering inbound webhooks, defining outbound URL actions, and reviewing recent events and delivery attempts with retry.

## Local setup

```bash
npm install
SESSION_SECRET="replace-with-a-long-random-secret" SESSION_SECURE=false npm start
```

Open `http://localhost:5094`.

## Environment

- `PORT` defaults to `5094`.
- `DATABASE_PATH` defaults to `./data/integration-hub.sqlite`.
- `SESSION_SECRET` is required in production and should be a long random value.
- `SESSION_SECURE` defaults to secure cookies. Set `SESSION_SECURE=false` only for local plain HTTP development.

The app uses SQLite, bcrypt password hashing, CSRF tokens, parameterised queries, security headers, ownership checks, and SSRF protections for all user-supplied outbound destinations.
