# Crowdfund

A small but complete crowdfunding site built with **Node.js / Express** and **SQLite**.
Creators launch campaigns with a funding goal and a deadline, backers pledge money, and
each campaign page shows the total raised and progress toward the goal.

## Features

- User registration / login / logout
- Create campaigns (title, description, goal, deadline)
- Pledge to other people's campaigns (not your own, not after the deadline)
- Per-campaign progress bar, total raised, and recent backers list
- Owner-only campaign deletion

## Requirements

- **Node.js 18+** (uses the built-in `node:crypto` and modern Express)
- A C/C++ build toolchain is needed the first time you install, because
  `better-sqlite3` compiles a native module:
  - **Windows:** install the "Desktop development with C++" workload, or run
    `npm install --global windows-build-tools` (older setups). Most recent
    Node installers can compile it out of the box.
  - **macOS:** `xcode-select --install`
  - **Linux:** `build-essential` (e.g. `sudo apt install build-essential python3`)

## Run it locally (port 5069)

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file
cp .env.example .env        # Windows PowerShell: copy .env.example .env

# 3. Generate a session secret and paste it into .env as SESSION_SECRET
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 4. Start the server
npm start
```

Then open <http://localhost:5069>.

The SQLite database and session store are created automatically under `./data/`
on first run. To start fresh, stop the server and delete the `data/` folder.

> In development you can skip setting `SESSION_SECRET` — a temporary one is
> generated and a warning is printed (sessions reset on restart). In production
> (`NODE_ENV=production`) a real `SESSION_SECRET` is **required** and the server
> refuses to start without one.

## Configuration

All configuration is read from environment variables (see `.env.example`):

| Variable         | Default                 | Purpose                                    |
| ---------------- | ----------------------- | ------------------------------------------ |
| `PORT`           | `5069`                  | Port the server listens on                 |
| `SESSION_SECRET` | _(required in prod)_    | Signs the session cookie                   |
| `NODE_ENV`       | `development`           | `production` enables the Secure cookie flag |
| `DATABASE_FILE`  | `./data/crowdfund.db`   | SQLite database location                   |

## Security

The app follows OWASP Top 10 practices:

- **SQL injection** — every query uses parameterised prepared statements
  (`better-sqlite3`); no string concatenation of user input.
- **Password storage** — passwords are hashed with **bcrypt** (cost 12) and a
  per-password salt; plaintext is never stored. Login uses a constant-time
  comparison and a dummy hash for unknown users to avoid user enumeration via timing.
- **Input validation** — all input is validated and normalised with
  `express-validator`; monetary amounts are parsed into integer cents.
- **XSS** — output is rendered with EJS `<%= %>` escaping (context-aware HTML
  encoding) and a strict Content-Security-Policy; no inline scripts.
- **CSRF** — a per-session synchronizer token is required on every state-changing
  (POST) request and verified with a constant-time comparison.
- **Access control / IDOR** — actions are tied to the authenticated user. Campaign
  deletion is scoped by `creator_id` in the query, and users cannot pledge to
  their own campaigns.
- **Secure session cookies** — `HttpOnly`, `SameSite=Lax`, and `Secure` (in
  production); session IDs are regenerated on login/registration to prevent
  fixation; cookie name is generic (`sid`).
- **Security headers** — set via `helmet` (CSP, X-Content-Type-Options,
  X-Frame-Options / frame-ancestors, Referrer-Policy, HSTS in production, etc.).
- **Error handling** — a central handler returns friendly messages; stack traces
  and internal errors are logged server-side only, never sent to clients.
- **Brute-force mitigation** — login and registration are rate-limited.
- **Secrets** — read from environment variables; nothing is hardcoded.

## Project layout

```
server.js            App setup: security headers, sessions, CSRF, routes, errors
db.js                SQLite connection + schema
lib/auth.js          Session user loading + auth guard
lib/csrf.js          Synchronizer-token CSRF middleware
lib/money.js         Cents <-> display helpers and amount parsing
routes/auth.js       Register / login / logout
routes/campaigns.js  List, create, view, pledge, delete
views/               EJS templates (auto-escaped output)
public/styles.css    Styles
```
