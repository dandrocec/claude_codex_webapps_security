# Habit Tracker

A small, secure habit tracker built with **Node.js + Express**. Register, log in,
define daily habits, tick them off each day, and watch your per-habit **streak** grow.
Data is stored in a local **SQLite** database.

## Features

- User registration & login (passwords hashed with **bcrypt**)
- Create / delete daily habits (scoped to the logged-in user)
- One-tap "mark done today" toggle per habit
- Automatic **current-streak** count per habit
- Server-rendered UI (EJS) with no client-side JS required

## Requirements

- Node.js **18+** and npm
- A C/C++ toolchain is needed to build `better-sqlite3`:
  - **Windows:** install the "Desktop development with C++" workload (Visual Studio Build Tools), or run `npm install --global windows-build-tools` on older setups.
  - **macOS:** `xcode-select --install`
  - **Linux:** `build-essential` (e.g. `sudo apt install build-essential python3`)

## Run it locally (port 5035)

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file
cp .env.example .env        # Windows PowerShell: copy .env.example .env

# 3. Generate a session secret and paste it into .env (SESSION_SECRET=...)
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 4. Start the server
npm start
```

Then open <http://localhost:5035> and register an account.

The SQLite database is created automatically at `./data/habits.db` on first run.

### Environment variables

| Variable         | Required | Default            | Purpose                                   |
| ---------------- | -------- | ------------------ | ----------------------------------------- |
| `SESSION_SECRET` | **Yes**  | —                  | Signs session cookies. Use a long random value. |
| `PORT`           | No       | `5035`             | HTTP port.                                |
| `NODE_ENV`       | No       | `development`      | Set to `production` behind HTTPS.         |
| `DB_PATH`        | No       | `./data/habits.db` | SQLite file location.                     |

The app refuses to start if `SESSION_SECRET` is missing.

## How the streak is counted

A habit's streak is the number of **consecutive days** it was marked done, ending
**today** (or **yesterday**, so a streak isn't lost until a full day is actually
missed). Marking a habit done again removes that day's check-in (toggle behaviour).

## Security notes

This app applies OWASP Top 10 best practices:

- **SQL injection** — every query uses parameterised prepared statements (`better-sqlite3`). No string concatenation of user input into SQL.
- **Password storage** — bcrypt with a per-user salt and a work factor of 12.
- **Input validation & XSS** — all input is validated/normalised with `express-validator`; output is rendered through EJS, which performs context-aware HTML escaping (`<%= %>`). A strict `Content-Security-Policy` (via Helmet) blocks inline/3rd-party scripts.
- **CSRF** — synchronizer-token pattern: a per-session token is embedded in every form and verified (constant-time) on all state-changing `POST` requests; cookies use `SameSite=Lax` as defence in depth.
- **Access control / IDOR** — protected routes require authentication, and every habit/check-in query is scoped by `user_id`, so users can only act on their own resources.
- **Session cookies** — `HttpOnly`, `SameSite=Lax`, and `Secure` (auto-enabled over HTTPS); session IDs are regenerated on login/registration to prevent fixation.
- **Security headers** — set by Helmet (CSP, `X-Content-Type-Options`, `Referrer-Policy`, frame-ancestors denial, etc.).
- **Error handling** — a central handler logs details server-side and returns a generic message; stack traces are never sent to clients.
- **Secrets** — read from environment variables; nothing is hardcoded.
- **Brute-force** — login/registration endpoints are rate-limited.

> For real production use, serve the app over **HTTPS** (so the `Secure` cookie flag
> activates) and set `NODE_ENV=production`.

## Project layout

```
server.js              App setup: security headers, sessions, CSRF, routes
db.js                  SQLite connection + schema
models.js              Parameterised data-access functions
lib/dates.js           Date helpers + streak calculation
middleware/security.js CSRF tokens + auth guards
routes/auth.js         Register / login / logout
routes/habits.js       Dashboard + habit CRUD + check-in toggle
views/                 EJS templates
public/style.css       Styles
```
