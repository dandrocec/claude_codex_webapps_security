# Feedback Portal

A small, secure Node.js / Express application:

- **Visitors** submit feedback (category, rating 1–5, comment) — no account needed.
- **Reviewers** log in to see all feedback in a sortable list.
- Data is stored in a local **SQLite** database.

## Requirements

- Node.js 18 or newer
- npm

`better-sqlite3` and `bcrypt` are native modules and compile on install. On
Windows this needs the Visual Studio "Desktop development with C++" build tools
(usually already present); on macOS/Linux a standard build toolchain.

## Run it locally (port 5048)

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file
cp .env.example .env        # Windows PowerShell: copy .env.example .env

# 3. Set a real session secret in .env, e.g. generate one with:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 4. Create the reviewer login (reads REVIEWER_USERNAME / REVIEWER_PASSWORD from .env)
npm run seed

# 5. Start the server
npm start
```

Open <http://localhost:5048>.

- Submit feedback from the home page.
- Log in at <http://localhost:5048/login> with the seeded reviewer credentials
  to view the dashboard. Click the **Category**, **Rating**, or **Submitted**
  column headers to sort.

The port is controlled by `PORT` in `.env` (defaults to `5048`).

## Configuration

All configuration is read from environment variables (`.env`); nothing secret is
hardcoded. See [`.env.example`](./.env.example) for the full list:

| Variable             | Purpose                                                    |
| -------------------- | ---------------------------------------------------------- |
| `PORT`               | Listen port (default `5048`).                              |
| `NODE_ENV`           | `production` enforces secure cookies + a real secret.      |
| `SESSION_SECRET`     | Signs the session cookie. Required & strong in production. |
| `REVIEWER_USERNAME`  | Username for the seeded reviewer account.                  |
| `REVIEWER_PASSWORD`  | Password for the seeded reviewer account (min 10 chars).   |

## Security measures (OWASP Top 10)

| Area | How it is handled |
| ---- | ----------------- |
| **A01 Broken Access Control / IDOR** | Reviewer pages are gated by `requireReviewer`. The dashboard exposes no per-record IDs in user-controllable actions, and reviewer routes verify role on every request. |
| **A02 Cryptographic Failures** | Passwords hashed with **bcrypt** (cost 12, per-password salt). Cookies signed with a secret from the environment. |
| **A03 Injection** | All SQL uses **parameterised queries** (`better-sqlite3` prepared statements). Dynamic `ORDER BY` uses a strict column/direction **allow-list**, never raw input. |
| **A03 XSS** | Input is validated/normalised with `express-validator`; output is rendered through **EJS auto-escaping** (`<%= %>`), giving context-aware encoding. A strict **Content-Security-Policy** blocks inline/3rd-party scripts. |
| **A04/A07 Auth** | Generic login errors (no user enumeration), constant-time bcrypt comparison, **session regeneration** on login (anti-fixation), and **login rate limiting**. |
| **CSRF** | Synchronizer-token middleware on every state-changing request (`_csrf` field / `x-csrf-token` header), verified in constant time. `SameSite=Strict` cookies add defence in depth. |
| **A05 Security Misconfiguration** | `helmet` security headers + explicit CSP, `frameAncestors 'none'`, `no-referrer`. Request body size limits. |
| **A07 Session cookies** | `HttpOnly`, `Secure` (in production), `SameSite=Strict`, named `sid`, 2-hour expiry, persisted in a SQLite session store. |
| **A09 Error handling** | Central error handler logs full detail server-side and returns **generic messages** — no stack traces or internals leak to clients. |
| **A05 Secrets** | No secrets in source; all read from environment variables. |

> Note: `Secure` cookies require HTTPS, so in local development (`NODE_ENV` not
> `production`) the flag is off to allow login over `http://localhost`. Set
> `NODE_ENV=production` behind HTTPS to enable it.

## Project layout

```
src/
  app.js              Express setup: helmet, sessions, CSRF, routes, error handler
  db.js               SQLite connection + schema
  seed.js             Creates/updates the reviewer account
  constants.js        Allowed categories + sort allow-lists
  middleware/
    auth.js           currentUser + requireReviewer access control
    csrf.js           Synchronizer-token CSRF protection
  routes/
    feedback.js       Public submission form + handler
    auth.js           Login / logout
    reviewer.js       Reviewer dashboard (sortable list)
  views/              EJS templates (auto-escaped)
public/
  styles.css
```
