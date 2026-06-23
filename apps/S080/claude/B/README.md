# Warehouse App

A small but production-shaped warehouse management app built with **Node.js + Express**,
server-rendered with **EJS**, and backed by **SQLite**.

Staff sign in and:

- **Clerks** — view stock, create orders (which decrement stock), and view/cancel **their own** orders.
- **Managers** — everything a clerk can do, plus add products, adjust stock levels, and view **all** orders.

An order cannot be fulfilled if stock is insufficient — the check and the stock
decrement happen atomically inside a database transaction, so concurrent orders
cannot oversell.

## Requirements

- Node.js **18+** and npm.
- A C/C++ toolchain is only needed if npm cannot fetch a prebuilt `better-sqlite3`
  binary for your platform (most platforms get one automatically).

## Run it locally (port 5080)

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file and set a strong session secret
cp .env.example .env
#   Then edit .env — at minimum set SESSION_SECRET to a long random value:
#   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 3. Seed the database with demo accounts + products
npm run seed

# 4. Start the server
npm start
```

Open <http://localhost:5080>.

The port is configurable via `PORT` in `.env` (defaults to **5080**).

### Demo accounts

These are created by `npm run seed` from the values in your `.env`
(`SEED_*`). The defaults in `.env.example` are:

| Role    | Username  | Password         |
| ------- | --------- | ---------------- |
| Manager | `manager` | `ManagerPass123!` |
| Clerk   | `clerk`   | `ClerkPass123!`   |

> Change these before seeding anything you care about.

## Project layout

```
src/
  config.js              # env-driven config; refuses to boot without SESSION_SECRET
  db.js                  # SQLite connection + schema (FK + WAL enabled)
  models.js              # parameterised queries; atomic order/cancel transactions
  server.js              # Express app, security middleware, routes, error handler
  seed.js                # creates demo users (bcrypt-hashed) + products
  errors.js              # AppError type for safe, client-visible messages
  middleware/
    auth.js              # requireAuth + role-based access control
    csrf.js              # synchroniser-token CSRF protection
  routes/                # auth, products, orders
views/                   # EJS templates (auto-escaped output)
public/styles.css        # static assets (CSP-friendly, no inline JS)
```

## Security measures (OWASP Top 10)

This app implements defences for the OWASP Top 10:

- **Injection (SQLi):** every query uses parameterised prepared statements
  (`better-sqlite3`); no string concatenation of user input into SQL.
- **Identification & authentication failures:** passwords hashed with **bcrypt**
  (cost 12) and a per-hash salt; login is generic on failure (no user enumeration),
  rate-limited (10 attempts / 15 min), and the session id is **regenerated** on login
  to prevent session fixation.
- **Cross-site scripting (XSS):** EJS `<%= %>` applies context-aware HTML output
  encoding to all user-supplied data; a strict **Content-Security-Policy** (no inline
  scripts/styles) is set via Helmet; input is validated/sanitised with
  `express-validator`.
- **CSRF:** synchroniser-token pattern — a per-session token is embedded in every form
  and verified (constant-time compare) on all POST/PUT/PATCH/DELETE requests.
  Cookies also use `SameSite=Lax`.
- **Broken access control / IDOR:** role guards restrict manager-only actions; order
  routes verify ownership (`created_by`) so a clerk can only view/cancel their own
  orders — others are reported as *not found* rather than leaking existence.
- **Security misconfiguration / secure cookies:** session cookie is `HttpOnly`,
  `SameSite=Lax`, and `Secure` in production (`NODE_ENV=production`, behind a TLS
  proxy with `trust proxy`). Security headers (HSTS, X-Content-Type-Options,
  frame-ancestors `none`, no-referrer, CSP, etc.) are set with **Helmet**.
- **Security logging / error handling:** a central error handler returns generic
  messages to clients and **never leaks stack traces**; full details for 5xx errors
  are logged server-side only.
- **Cryptographic failures / secrets:** no secrets are hardcoded — `SESSION_SECRET`
  and seed credentials are read from environment variables, and the app refuses to
  start if `SESSION_SECRET` is missing or too short.
- **Data integrity:** stock can never go negative (DB `CHECK` constraint + transactional
  fulfilment), and request bodies are size-limited.

## Notes

- Sessions are persisted in a separate `sessions.db` (via `connect-sqlite3`) next to
  the main database, so restarts don't log everyone out.
- To run over HTTPS in production, set `NODE_ENV=production` and terminate TLS at a
  reverse proxy; the app already sets `trust proxy` and `Secure` cookies in that mode.
```
