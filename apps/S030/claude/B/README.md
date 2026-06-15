# Secure Bookmark Manager

A small Node.js / Express application where registered users can save links
(title, URL, tags), edit and delete them, and view their own list filtered by
tag. Data is stored in a SQLite database. The app is built with the
**OWASP Top 10** in mind.

## Features

- User registration & login (sessions)
- Create / edit / delete bookmarks (title, URL, comma-separated tags)
- Per-user lists — you only ever see and act on **your own** bookmarks
- Filter your bookmarks by tag
- Server-rendered UI (EJS) with auto-escaped output

## Requirements

- Node.js **18+** (tested on Node 24)
- npm

`better-sqlite3` and `bcrypt` are native modules; npm will compile them on
install. On Windows this needs the standard build tools that ship with a normal
Node.js installation. No external database server is required — SQLite files are
created automatically in `./data`.

## Run it locally (port 5030)

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file
cp .env.example .env          # Windows PowerShell: copy .env.example .env

# 3. Generate a strong session secret and paste it into .env (SESSION_SECRET=...)
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 4. Start the server
npm start
```

Then open <http://localhost:5030>. Register an account and start adding
bookmarks.

The listening port is controlled by `PORT` in `.env` (defaults to **5030**).

### Production note

Set `NODE_ENV=production` and serve the app over HTTPS (e.g. behind a reverse
proxy). In production the session cookie's `Secure` flag is enforced, HSTS is
enabled, and the app refuses to start unless a strong `SESSION_SECRET` is set.

## Project layout

```
src/
  app.js                 # app wiring, security middleware, error handling
  db.js                  # SQLite connection + schema
  models.js              # data access — all parameterised queries
  lib/tags.js            # tag normalisation helpers
  middleware/
    auth.js              # load current user, requireAuth gate
    csrf.js              # synchronizer-token CSRF protection
  routes/
    auth.js              # register / login / logout
    bookmarks.js         # bookmark CRUD + tag filter (owner-scoped)
  views/                 # EJS templates (auto-escaped output)
  public/style.css       # styles
data/                    # SQLite files (created at runtime, git-ignored)
```

## How the security requirements are met

| Requirement | Where / how |
|---|---|
| **SQL injection** | All DB access in `src/models.js` uses `better-sqlite3` prepared statements with bound parameters — no string concatenation. |
| **Password storage** | Passwords hashed with **bcrypt** (cost 12, per-password salt) in `src/routes/auth.js`. Hashes are never sent to the client. |
| **Input validation** | `express-validator` rules validate username, password, title, URL and tags. URLs are restricted to `http`/`https` (blocks `javascript:`/`data:`). Tags are normalised/whitelisted in `src/lib/tags.js`. |
| **XSS (output encoding)** | EJS `<%= %>` performs context-aware HTML escaping for every value rendered. A strict **Content-Security-Policy** (via Helmet) blocks inline/3rd-party scripts as defence in depth. |
| **CSRF** | Synchronizer-token pattern (`src/middleware/csrf.js`): a per-session token is required on every POST and compared in constant time. `SameSite=Lax` cookies add a second layer. |
| **Access control / IDOR** | Every bookmark query is scoped to `user_id = <current user>`. Editing/deleting a row you don't own affects 0 rows and returns 404. Routes are gated by `requireAuth`. |
| **Secure session cookies** | `HttpOnly`, `SameSite=Lax`, and `Secure` (in production) on the `sid` cookie; sessions stored server-side (SQLite); session is regenerated on login to prevent fixation. |
| **Security headers** | **Helmet** sets CSP, `X-Content-Type-Options`, `X-Frame-Options`/`frame-ancestors 'none'`, `Referrer-Policy`, HSTS (production), etc. |
| **Error handling** | A central error handler logs details server-side and returns generic messages — **no stack traces** are sent to clients. |
| **Secrets management** | `SESSION_SECRET` and other config are read from environment variables (`.env`, git-ignored). Nothing is hardcoded; the app refuses to start in production without a strong secret. |
| **Brute-force protection** | `express-rate-limit` throttles the auth endpoints. |

## Resetting the data

Stop the server and delete the `data/` directory; it will be recreated empty on
the next start.
