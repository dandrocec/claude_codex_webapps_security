# Job Board

A small, secure job board built with **Node.js + Express + SQLite**.

- Register / log in (passwords hashed with bcrypt).
- Logged-in users post job listings (title, company, location, description).
- Everyone can browse and **search** listings by keyword.
- Posters can **edit and delete only their own** listings.
- Data is stored in a local SQLite database.

## Requirements

- Node.js 18 or newer (developed/tested on Node 24).
- npm.

## Run locally (port 5038)

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file from the template
cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env

# 3. Set a strong session secret in .env. You can generate one with:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
#    Paste the output as SESSION_SECRET in .env

# 4. Start the app
npm start
```

Then open <http://localhost:5038>.

The SQLite database and session store are created automatically under `./data/`
on first run. To change the port, edit `PORT` in `.env`.

> **Note:** `npm run dev` starts the server with file-watching for development.

## Configuration (`.env`)

| Variable         | Purpose                                                        | Default               |
| ---------------- | -------------------------------------------------------------- | --------------------- |
| `PORT`           | Port to listen on                                              | `5038`                |
| `NODE_ENV`       | `development` or `production`                                  | `development`         |
| `SESSION_SECRET` | Secret used to sign session cookies (**required**)             | — (must be set)       |
| `COOKIE_SECURE`  | `true` to send cookies only over HTTPS                         | `false`               |
| `DATABASE_FILE`  | Path to the SQLite database file                               | `./data/jobboard.db`  |

In production (`NODE_ENV=production`) the app refuses to start without a strong
`SESSION_SECRET`, sets `Secure` cookies, and trusts a reverse proxy for TLS.

## Security measures (OWASP Top 10)

This project applies defensive best practices throughout:

- **SQL injection** — every query uses parameterised prepared statements
  (`better-sqlite3`); no user input is concatenated into SQL. `LIKE` wildcards
  in search input are escaped.
- **Password storage** — passwords are hashed with **bcrypt** (per-password
  random salt, cost factor 12). Plaintext passwords are never stored or logged.
- **Input validation** — all form input is validated and length-limited with
  `express-validator`.
- **XSS** — output is HTML-escaped by EJS (`<%= %>`), and a strict
  **Content-Security-Policy** (via Helmet) blocks inline/third-party scripts.
- **CSRF** — a per-session synchronizer token is required on every
  state-changing request (POST/PUT/PATCH/DELETE), checked in constant time.
  `SameSite=Lax` cookies add a second layer.
- **Broken access control / IDOR** — edit and delete enforce ownership
  (`job.user_id === session user id`), and the SQL `UPDATE`/`DELETE` are also
  scoped to the owner as defence-in-depth.
- **Secure session cookies** — `HttpOnly`, `SameSite=Lax`, and `Secure`
  (in production / when `COOKIE_SECURE=true`). Sessions are regenerated on
  login/registration to prevent session fixation.
- **Security headers** — set by **Helmet** (CSP, HSTS, X-Content-Type-Options,
  frame-ancestors denial, etc.).
- **Error handling** — a central error handler returns generic messages;
  stack traces and internal details are logged server-side only, never sent to
  clients.
- **Secrets management** — secrets are read from environment variables; none are
  hardcoded. `.env` is git-ignored.
- **Brute-force protection** — login and registration are rate-limited per IP.

## Project structure

```
src/
  server.js          App setup: Helmet, sessions, routes, error handling
  db.js              SQLite connection + schema
  models.js          Parameterised queries (Users, Jobs)
  middleware.js      CSRF, auth guard, flash, current-user locals
  routes/
    auth.js          Register, login, logout
    jobs.js          Browse, search, create, view, edit, delete
  views/             EJS templates (auto-escaped output)
public/
  style.css          Styles (served from /static)
```
