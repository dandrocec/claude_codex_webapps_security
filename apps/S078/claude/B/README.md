# CRM (Node.js / Express)

A small sales CRM. Sales users manage their own **contacts** and **deals**, and
move deals through pipeline stages on a board. A **manager** role sees the whole
team's contacts and deals (and can still only modify their own records).

Built with Express, EJS (auto-escaping templates), and SQLite via
`better-sqlite3`. No external database server required.

## Features

- Email/password auth with registration, login, logout.
- Roles: `sales` (sees own data) and `manager` (sees the whole team).
- Contacts: create, view, edit, delete.
- Deals: create, edit, delete, and a **pipeline board** grouped by stage
  (Lead → Qualified → Proposal → Negotiation → Won / Lost) with per-deal stage moves.
- Dashboard with open/won counts and pipeline value.

## Requirements

- Node.js 18 or newer (includes npm).

## Run it locally (port 5078)

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file and set a session secret
cp .env.example .env
# then edit .env and set SESSION_SECRET to a long random value, e.g.:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 3. (Optional) seed demo accounts and sample data
npm run seed

# 4. Start the server
npm start
```

Open <http://localhost:5078>.

On Windows PowerShell, replace `cp` with `Copy-Item .env.example .env`.

### Demo accounts (after `npm run seed`)

| Email                 | Password         | Role    |
| --------------------- | ---------------- | ------- |
| manager@example.com   | managerpass123   | manager |
| alice@example.com     | alicepass123     | sales   |
| bob@example.com       | bobpass1234      | sales   |

Log in as Alice or Bob to see only their own data; log in as the manager to see
everyone's. (Demo passwords are for local exploration only — change them.)

## Configuration

All configuration comes from environment variables (see `.env.example`):

| Variable         | Purpose                                                        |
| ---------------- | ------------------------------------------------------------- |
| `PORT`           | Port to listen on (default `5078`).                            |
| `NODE_ENV`       | Set to `production` behind HTTPS to enable Secure cookies.     |
| `SESSION_SECRET` | **Required.** Secret used to sign the session cookie.          |

The SQLite database and session store are created under `data/` on first run.

## How the security requirements are met (OWASP Top 10)

- **SQL injection** — every query uses `better-sqlite3` prepared statements with
  bound parameters (`src/models.js`); no string concatenation of user input.
- **Password storage** — bcrypt with a per-password salt and cost factor 12
  (`src/routes/auth.js`, `src/seed.js`).
- **Input validation & sanitisation** — `express-validator` validates/normalises
  all form input; lengths, types, email format, and stage enums are enforced.
- **XSS / output encoding** — EJS escapes all interpolated output via `<%= %>`;
  a strict Content-Security-Policy (no inline scripts) adds defence-in-depth.
- **CSRF** — synchroniser-token middleware (`src/middleware/csrf.js`) injects a
  per-session token into every form and validates it (constant-time compare) on
  all POST requests; cookies are `SameSite=Lax` as an extra layer.
- **Access control / IDOR** — all reads and writes are scoped by `owner_id`;
  edit/delete operations only succeed for the owning user, and the manager view
  is read-only over other users' records (`src/models.js`, route handlers).
- **Secure session cookies** — `HttpOnly`, `SameSite=Lax`, and `Secure` in
  production; session is regenerated on login/registration to prevent fixation.
- **Security headers** — `helmet` sets CSP, `X-Content-Type-Options`,
  `Referrer-Policy`, frame-ancestors denial, etc.
- **Error handling** — a central handler logs server-side and returns a generic
  message; no stack traces or internal details reach the client.
- **Secrets** — read from environment variables; the app refuses to start
  without `SESSION_SECRET` and ships no hardcoded secrets.
- **Brute-force protection** — login and registration are rate-limited
  (`express-rate-limit`).

## Project layout

```
src/
  app.js            Express app: middleware, security headers, routes
  server.js         Entry point (loads .env, starts the server)
  db.js             SQLite connection + schema + pipeline stages
  models.js         Prepared statements (data access layer)
  seed.js           Demo data seeder
  middleware/
    auth.js         Session user loading + auth/role guards
    csrf.js         CSRF token middleware
  routes/
    auth.js         Register / login / logout
    contacts.js     Contacts CRUD
    deals.js        Deals CRUD + pipeline board + stage moves
views/              EJS templates (auto-escaped)
public/css/         Stylesheet
data/               SQLite db + session store (created at runtime)
```
