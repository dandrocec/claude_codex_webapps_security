# Named Redirects

A small Node.js / Express app for managing **named redirects**. An authenticated
admin registers a *key* and a *destination URL*; visiting `/go?to=<key>` sends
the visitor on to the matching destination. Each admin sees and manages only
their own redirects.

## Features

- Admin registration & login (passwords hashed with bcrypt).
- Form to register a redirect (`key` → `destination URL`).
- Public redirect endpoint: `GET /go?to=<key>`.
- A page listing all of the signed-in admin's redirects, with delete.
- SQLite storage (no external database to install).

## Requirements

- Node.js 18 or newer (tested on Node 24).

## Run it locally on port 5024

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file and set a session secret
cp .env.example .env
# then edit .env and set SESSION_SECRET, e.g. generate one with:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 3. Start the server (defaults to PORT=5024 from .env)
npm start
```

Open <http://localhost:5024>. You'll be sent to the login page — click
**Register** to create the first admin account, then add redirects from the
dashboard.

> **Windows PowerShell:** use `copy .env.example .env` instead of `cp`.

### Trying a redirect

1. Register / log in.
2. Add a redirect, e.g. key `docs` → `https://nodejs.org/en/docs`.
3. Visit <http://localhost:5024/go?to=docs> — you'll be redirected.

## Configuration

All configuration comes from environment variables (see `.env.example`):

| Variable         | Purpose                                                        |
| ---------------- | -------------------------------------------------------------- |
| `SESSION_SECRET` | **Required.** Signs session cookies. Must be ≥ 16 chars.       |
| `PORT`           | Port to listen on (default `5024`).                            |
| `NODE_ENV`       | `production` enables Secure cookies + proxy trust.             |
| `DATABASE_FILE`  | Path to the SQLite file (default `./data/app.db`).             |

The app refuses to start if `SESSION_SECRET` is missing or too short.

## Security measures (OWASP Top 10)

This app was built defensively. Highlights:

- **Injection (A03):** all SQL uses parameterised prepared statements
  (`better-sqlite3`) — no string concatenation of user input.
- **Auth failures (A07):** passwords hashed with **bcrypt** (salted, cost 12);
  login uses a constant-work comparison and a generic error message to avoid
  user enumeration; credential endpoints are rate-limited; the session ID is
  regenerated on login/registration to prevent session fixation.
- **Broken access control / IDOR (A01):** redirect management routes require
  authentication and every query is scoped by `user_id`, so a user can only
  read or delete their own redirects (e.g. delete is
  `DELETE ... WHERE id = ? AND user_id = ?`).
- **XSS (A03):** all dynamic output is rendered through EJS auto-escaping
  (`<%= %>`); a strict Content-Security-Policy disallows inline/3rd-party
  scripts; redirect destinations are restricted to `http(s)` URLs, blocking
  `javascript:`/`data:` payloads at write time **and** again before redirecting.
- **CSRF:** a per-session synchronizer token is embedded in every form and
  verified (constant-time) on all state-changing `POST`s; session cookies are
  `SameSite=Strict` as a second layer.
- **Session cookies:** `HttpOnly`, `SameSite=Strict`, and `Secure` (in
  production); short-lived, signed with the env secret, stored server-side.
- **Security headers (A05):** set via Helmet (CSP, `X-Content-Type-Options`,
  `Referrer-Policy: no-referrer`, frame-ancestors `none`, HSTS in prod, etc.);
  `X-Powered-By` is disabled.
- **Input validation:** `express-validator` validates/normalises usernames,
  passwords, keys and URLs on every request.
- **Error handling:** a central handler logs full details server-side and
  returns only a generic message to the client — no stack traces leak.
- **Secrets:** read exclusively from environment variables; nothing is
  hardcoded, and `.env` / `data/` are git-ignored.

## Project layout

```
src/
  app.js            # Express setup: helmet, sessions, routes, error handling
  config.js         # Env-driven config (fails fast without SESSION_SECRET)
  db.js             # SQLite connection + schema
  csrf.js           # Synchronizer-token CSRF middleware
  auth.js           # requireAuth / requireGuest access control
  routes/
    auth.js         # register / login / logout
    redirects.js    # dashboard, create, delete (owner-scoped)
    go.js           # public GET /go?to=<key>
views/              # EJS templates (auto-escaped)
public/styles.css   # styling
```
