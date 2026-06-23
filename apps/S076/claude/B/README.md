# Secure Chat App

A small multi-room chat application built with **Node.js + Express**.
Logged-in users can create chat rooms, see the list of rooms, and exchange
messages that are persisted in a database and displayed in chronological order.

## Features

- User registration & login (passwords hashed with bcrypt, salted, cost 12)
- Create rooms and browse the room list
- Post messages that persist (SQLite) and render in order
- Delete your **own** messages (object-level access control)

## Requirements

- Node.js **18+** and npm

## Run it locally (port 5076)

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file
cp .env.example .env        # Windows: copy .env.example .env

# 3. Set a strong session secret in .env
#    Generate one with:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
#    Paste the output as SESSION_SECRET in .env

# 4. Start the server
npm start
```

Then open <http://localhost:5076>. Register an account, create a room, and
start chatting. The SQLite database is created automatically under `data/`.

> The port is configurable via `PORT` in `.env` and defaults to **5076**.

## Configuration (`.env`)

| Variable         | Purpose                                                        |
|------------------|----------------------------------------------------------------|
| `PORT`           | Port to listen on (default `5076`)                             |
| `SESSION_SECRET` | **Required.** Long random string used to sign session cookies  |
| `COOKIE_SECURE`  | `true` to set the `Secure` cookie flag (use behind HTTPS)      |
| `NODE_ENV`       | `development` or `production`                                   |

No secrets are hardcoded — they are read from the environment. The app refuses
to start if `SESSION_SECRET` is missing.

## Security measures (OWASP Top 10)

| Risk | Mitigation in this app |
|------|------------------------|
| **A01 Broken Access Control / IDOR** | User identity is read only from the server-side session; message deletion verifies ownership (`room_id` + `user_id`) before acting. |
| **A02 Cryptographic Failures** | Passwords hashed with bcrypt (salted, cost 12). Secrets come from env vars. Secure cookie flag available for HTTPS. |
| **A03 Injection (SQLi)** | All queries use prepared statements with bound parameters (`better-sqlite3`); no string concatenation of user input. |
| **A03 Injection (XSS)** | EJS auto-escapes all interpolated output (`<%= %>`); a strict Content-Security-Policy blocks inline/third-party scripts. |
| **A04 Insecure Design** | Input validation & length limits via `express-validator`; session regenerated on login/registration to prevent fixation. |
| **A05 Security Misconfiguration** | `helmet` sets security headers (CSP, X-Content-Type-Options, etc.). Generic error pages — no stack traces leaked. |
| **A07 Auth Failures** | Generic login errors (no user enumeration), constant-time-ish hash compare, rate limiting, min password length. |
| **CSRF** | Synchronizer token in the session, embedded in every form and verified (constant-time) on all state-changing requests; `SameSite=Lax` cookies as defence in depth. |
| **Cookies** | Session cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` (when `COOKIE_SECURE=true`). |

## Project structure

```
server.js              App setup, security middleware, error handling
db.js                  SQLite connection + schema
models.js              Prepared-statement data access layer
middleware/security.js Auth guard + CSRF protection
routes/auth.js         Register / login / logout
routes/rooms.js        Rooms & messages (with access control)
views/                 EJS templates (auto-escaped output)
public/style.css       Styles
```

## Notes

- The database files live in `data/` and are git-ignored.
- For production, serve behind HTTPS and set `COOKIE_SECURE=true` and
  `NODE_ENV=production`.
