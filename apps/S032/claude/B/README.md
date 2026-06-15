# Personal Expense Tracker

A small, secure expense tracker built with Node.js, Express, EJS, and SQLite.

Users register and log in, then record expenses (amount, category, date, note),
edit or delete their own entries, and see a per-month total.

## Features

- User registration & login (passwords hashed with **bcrypt**, 12 rounds)
- Add / edit / delete expenses
- Filter by month with an automatic monthly total
- Each user sees and manages only their own data

## Requirements

- Node.js **18+** (tested on Node 24)
- npm

`better-sqlite3` ships prebuilt binaries for common platforms, so no separate
database server is required. The SQLite files are created automatically under
`./data/`.

## Run it locally (port 5032)

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file
cp .env.example .env        # Windows PowerShell: copy .env.example .env

# 3. Set a strong session secret in .env
#    Generate one with:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
#    Paste the output as SESSION_SECRET in .env

# 4. Start the server
npm start
```

Then open <http://localhost:5032>, register an account, and start tracking.

The port is controlled by `PORT` in `.env` (defaults to `5032`).

## Environment variables

| Variable         | Purpose                                                        |
| ---------------- | -------------------------------------------------------------- |
| `PORT`           | Port to listen on (default `5032`).                            |
| `SESSION_SECRET` | Secret used to sign the session cookie. **Required.**          |
| `NODE_ENV`       | `development` (default) or `production`.                       |

> In `development`, if `SESSION_SECRET` is missing the app generates a temporary
> one so it still runs (sessions reset on restart). In `production` a missing
> secret is a fatal error, and the session cookie is marked `Secure` (HTTPS only).

## Project structure

```
src/
  app.js              # Express app: security middleware, sessions, routing
  config.js           # Env-driven config (secrets, port, category whitelist)
  db.js               # SQLite connection + schema
  helpers.js          # Month-range and money formatting helpers
  middleware/
    auth.js           # Session user loading + route guards (access control)
    csrf.js           # Synchronizer-token CSRF protection
  models/
    users.js          # Parameterised user queries
    expenses.js       # Parameterised, user-scoped expense queries
  routes/
    auth.js           # register / login / logout
    expenses.js       # expense CRUD
  views/              # EJS templates (auto-escaped output)
public/css/style.css  # Styling
data/                 # SQLite database + session store (auto-created, git-ignored)
```

## Security notes

This app applies OWASP Top 10 best practices:

- **SQL injection** — every query uses bound parameters via `better-sqlite3`
  prepared statements; no string concatenation of user input.
- **Password storage** — bcrypt with a per-password salt and a work factor of 12.
- **Input validation** — `express-validator` validates and sanitises all input
  server-side (amounts, dates, category whitelist, length limits).
- **XSS** — EJS `<%= %>` performs context-aware HTML output encoding; a strict
  Content-Security-Policy (via Helmet) blocks inline/external script injection.
- **CSRF** — synchronizer token required on every state-changing (POST) request,
  compared in constant time; cookies use `SameSite=Lax` as defence in depth.
- **Access control / IDOR** — every expense query is scoped by `user_id`, so a
  user can never read or modify another user's rows even by guessing an id.
- **Session security** — cookies are `HttpOnly`, `SameSite=Lax`, and `Secure`
  in production; the session id is regenerated on login/registration to prevent
  fixation.
- **Security headers** — Helmet sets CSP, HSTS, `X-Content-Type-Options`,
  frame-ancestors, referrer policy, etc.
- **Error handling** — a central handler logs details server-side and returns
  generic messages; stack traces are never sent to the client.
- **Brute force** — authentication routes are rate limited.
- **Secrets** — read exclusively from environment variables; nothing hardcoded.

## Notes

- Amounts are stored as integer cents to avoid floating-point rounding errors.
- Deleting a user cascades to their expenses (foreign key `ON DELETE CASCADE`).
