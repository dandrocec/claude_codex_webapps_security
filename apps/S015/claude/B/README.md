# Countdown App

A small multi-user web app built with **Node.js / Express**. Each user registers,
logs in, and creates countdown events. For every event you enter a **target date &
time** and an **event label**; the app then shows a live page counting down to that
moment and displaying the label.

## Features

- Register / log in / log out (passwords hashed with bcrypt)
- Create a countdown from a form (target date + label)
- Live countdown page (days / hours / minutes / seconds), updated every second
- List and delete your own countdowns
- Data stored in a local SQLite file (created automatically on first run)

## Requirements

- Node.js 18 or newer (includes npm)

## Run locally on port 5015

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file and set a real secret
cp .env.example .env
# then edit .env and set SESSION_SECRET to a long random string, e.g.:
#   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 3. Start the server (defaults to port 5015)
npm start
```

Then open **http://localhost:5015** in your browser.

> On Windows PowerShell, replace `cp` with `Copy-Item .env.example .env`.

The default port is `5015`. To change it, set `PORT` in `.env`.

## Project structure

```
src/
  server.js              app setup, security middleware, routes, error handling
  db.js                  SQLite connection + schema (parameterised statements)
  middleware/security.js CSRF protection, auth guard, current-user exposure
  routes/auth.js         register / login / logout
  routes/events.js       create / view / list / delete countdowns
  views/                 EJS templates (auto-escaped output)
public/
  css/styles.css         styling
  js/countdown.js        client-side countdown timer
data/                    SQLite database + session store (auto-created, gitignored)
```

## Security notes (OWASP Top 10)

This demo applies defence-in-depth:

- **Injection (A03):** every SQL statement uses bound parameters (`?`) via
  `better-sqlite3` prepared statements — user input is never concatenated into SQL.
- **Authentication (A07):** passwords are hashed with **bcrypt** (cost 12, salted).
  Login uses a constant-time comparison and a generic error to avoid user
  enumeration, plus rate limiting on auth routes. Sessions are regenerated on login
  to prevent session fixation.
- **Access control / IDOR (A01):** every event query is scoped with
  `WHERE ... user_id = ?`, so a user can only read or delete their own events.
  Unknown/foreign IDs return a generic 404.
- **XSS (A03):** all dynamic output is rendered through EJS auto-escaping
  (`<%= %>`); the client timer writes only numbers via `textContent`. A strict
  **Content-Security-Policy** (no inline scripts/styles) is set via Helmet.
- **CSRF:** a per-session synchronizer token is required on every state-changing
  POST, reinforced by `SameSite=Lax` cookies.
- **Session cookies:** `HttpOnly`, `SameSite=Lax`, and `Secure` (enabled in
  production or when `COOKIE_SECURE=true`).
- **Security headers (A05):** Helmet sets CSP, HSTS, `X-Content-Type-Options`,
  frame-ancestors `none`, a strict referrer policy, and more.
- **Error handling:** internal errors are logged server-side; clients only ever
  see a generic message — no stack traces.
- **Secrets:** `SESSION_SECRET` is read from the environment; the app refuses to
  start in production without it.
- **Input validation:** all input is validated and length-limited with
  `express-validator`; request bodies are size-capped.

### Production checklist

- Serve over HTTPS and set `COOKIE_SECURE=true` and `NODE_ENV=production`.
- Set a strong unique `SESSION_SECRET`.
- Keep dependencies updated (`npm audit`).
