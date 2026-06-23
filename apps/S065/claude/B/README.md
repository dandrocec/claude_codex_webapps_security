# Q&A Site

A small but complete question-and-answer web application built with **Node.js**,
**Express**, **EJS**, and **SQLite** (`better-sqlite3`).

## Features

- Register, log in, and log out (passwords hashed with bcrypt).
- Post questions and answers.
- Vote questions and answers up or down — **one vote per user per item** (re-clicking
  the same direction removes your vote; clicking the other direction switches it).
- The question owner can **accept** one answer.
- Answers are **sorted by score** (accepted answer first, then highest score).

## Requirements

- Node.js 18 or newer (tested on Node 24).
- npm.

`better-sqlite3` is a native module, so a working C/C++ build toolchain is needed
to install it (most systems already have one; on Windows the standard MSVC build
tools that ship with recent Node installers are sufficient).

## Run it locally (port 5065)

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file
cp .env.example .env          # Windows PowerShell: copy .env.example .env

# 3. Generate a strong session secret and paste it into .env as SESSION_SECRET
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 4. Start the server
npm start
```

Then open <http://localhost:5065>.

The port is configurable via the `PORT` variable in `.env` (defaults to `5065`).
The SQLite database and session store are created automatically under `./data/`.

## Environment variables

| Variable         | Purpose                                                        | Default       |
|------------------|----------------------------------------------------------------|---------------|
| `PORT`           | Port to listen on                                              | `5065`        |
| `NODE_ENV`       | `development` or `production`                                  | `development` |
| `SESSION_SECRET` | Secret used to sign the session cookie (**required**)         | _none_        |
| `COOKIE_SECURE`  | Force the `Secure` cookie flag (set `true` behind HTTPS)       | `false`       |

The server refuses to start if `SESSION_SECRET` is missing or too short — no
secrets are hardcoded.

## Security measures (OWASP Top 10)

- **SQL injection** — every query uses parameterised prepared statements
  (`better-sqlite3`); no string concatenation of user input into SQL.
- **Password storage** — bcrypt with a per-password salt and a work factor of 12.
- **Input validation** — `express-validator` validates and length-bounds all input;
  usernames are character-restricted.
- **XSS** — all dynamic output is rendered through EJS's context-aware HTML
  escaping (`<%= %>`); a strict Content-Security-Policy disallows inline scripts.
- **CSRF** — a per-session synchroniser token is required on every state-changing
  request and compared in constant time.
- **Access control / IDOR** — accepting an answer and voting are scoped to the
  authenticated user; ownership is enforced in the query/handler, and users cannot
  vote on their own posts.
- **Secure session cookies** — `HttpOnly`, `SameSite=Lax`, and `Secure`
  (in production / when `COOKIE_SECURE=true`); session IDs are regenerated on login.
- **Security headers** — set via `helmet` (CSP, `X-Content-Type-Options`,
  frame-ancestors denial, no-referrer, etc.).
- **Error handling** — a central handler returns generic messages to clients and
  logs details server-side only; stack traces are never exposed.
- **Rate limiting** — login/registration and write endpoints are rate-limited.
- **Secrets** — read exclusively from environment variables.

## Project layout

```
src/
  server.js            # entry point: loads env, starts the server
  app.js               # Express app, middleware, security config
  db.js                # SQLite connection + schema
  models.js            # parameterised data-access functions
  middleware/
    security.js        # CSRF, auth guard, current-user loader
  routes/
    auth.js            # register / login / logout
    questions.js       # questions, answers, votes, accept
views/                 # EJS templates (auto-escaped output)
public/style.css       # styles
```
