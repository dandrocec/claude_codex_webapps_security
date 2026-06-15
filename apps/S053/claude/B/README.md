# Secure Portfolio

A small Node.js / Express portfolio site.

- **Public page** (`/`) shows all projects as a responsive grid.
- **Owner area** (`/admin`) lets a logged-in owner create, edit and delete their
  own projects (title, description, link, image URL).
- Data is stored in a **SQLite** database (zero external services to install).

The image is stored as a validated **http(s) URL** rather than an uploaded file.
This keeps the attack surface small (no file-upload handling) while still
showing real images in the grid.

## Requirements

- Node.js 18 or newer (developed/tested on Node 24)
- npm

`better-sqlite3` ships prebuilt binaries for common platforms; if your platform
needs to compile it, you'll need the usual build tools (on Windows, the
"Desktop development with C++" workload).

## Run it locally (port 5053)

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file and set a strong session secret
cp .env.example .env
#   Then edit .env and set SESSION_SECRET. Generate one with:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 3. Initialize the database
npm run init-db

# 4. Create the owner account (username + password)
npm run create-owner -- myname "a-strong-password-min-10-chars"

# 5. Start the server
npm start
```

Open <http://localhost:5053>. Log in via **Owner login** with the credentials
you created in step 4, then manage projects from the dashboard.

> On Windows PowerShell, use `copy .env.example .env` instead of `cp`.

### Configuration (.env)

| Variable        | Purpose                                                            |
| --------------- | ----------------------------------------------------------------- |
| `PORT`          | Port to listen on (default `5053`).                               |
| `NODE_ENV`      | `development` or `production`.                                    |
| `SESSION_SECRET`| **Required.** Long random string used to sign the session cookie. |
| `COOKIE_SECURE` | Set `true` only when serving over HTTPS (enables Secure cookies). |
| `DATABASE_PATH` | Path to the SQLite file (default `./data/portfolio.db`).         |

No secrets are hardcoded; the app refuses to start without `SESSION_SECRET`.

## Security measures (OWASP Top 10)

This project deliberately applies the OWASP Top 10 controls:

- **A01 Broken Access Control / IDOR** — Admin routes require authentication.
  Every project lookup verifies `owner_id === currentUser.id`, and update/delete
  SQL is additionally scoped by `owner_id` as defence in depth. Non-owned or
  missing resources return an indistinguishable 404 (no information leak).
- **A02 Cryptographic Failures** — Passwords hashed with **bcrypt** (cost 12,
  per-password salt). Session cookie is `HttpOnly`, `SameSite=Lax`, and `Secure`
  when `COOKIE_SECURE=true`.
- **A03 Injection (SQLi)** — All database access uses **parameterised prepared
  statements** (`better-sqlite3`); no user input is concatenated into SQL.
- **A03 Injection (XSS)** — All dynamic output is rendered through EJS
  auto-escaping (`<%= %>`); a strict **Content-Security-Policy** (no inline
  scripts) is set via Helmet. URLs are validated to `http(s)` only, blocking
  `javascript:`/`data:` URI injection into links.
- **A04 Insecure Design** — Login rate limiting, generic auth errors (no user
  enumeration), session regeneration on login (anti session-fixation), request
  body size limits.
- **A05 Security Misconfiguration** — **Helmet** sets security headers (CSP,
  `X-Content-Type-Options`, `Referrer-Policy`, frame-ancestors `none`, etc.).
  Errors are handled centrally; **stack traces and internal messages are never
  sent to clients** (logged server-side only).
- **A07 Identification & Authentication Failures** — Strong password minimum
  (≥10 chars), bcrypt verification with constant-ish timing for unknown users,
  rate-limited login.
- **A08 Software & Data Integrity** — CSRF protection (synchronizer token in the
  session, compared with `timingSafeEqual`) on **all** state-changing requests.
- **A09 Logging** — Server-side error logging without leaking details to users.
- **A10 SSRF** — The app never fetches user-supplied URLs server-side; image and
  link URLs are only rendered client-side after validation.

## Project structure

```
src/
  app.js            Express app: middleware, security headers, routes
  server.js         Entry point (listens on PORT)
  config.js         Env-driven config; fails fast without SESSION_SECRET
  db.js             SQLite connection + schema
  models.js         Parameterised data-access layer
  middleware/       auth, csrf, validators, error handling
  routes/           public, auth, projects (admin)
  views/            EJS templates (auto-escaped)
  scripts/          init-db, create-owner
public/css/         Stylesheet (served from /static)
```

## Notes

- This is a single-owner-friendly app: any account created with
  `create-owner` is an owner and manages only its own projects.
- For production, serve behind HTTPS and set `NODE_ENV=production` and
  `COOKIE_SECURE=true`.
