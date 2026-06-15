# Password Strength Checker

A small Node.js / Express app. A signed-in user types a candidate password into
a form and the server returns a strength rating — **weak / medium / strong** —
based on length and character variety, plus brief feedback on how to improve it.
Candidate passwords are evaluated in memory and **never stored**; users may
optionally save the resulting *rating* (not the password) to their own history.

## Requirements

- Node.js **18+** (uses the built-in test runner and `node --watch`)
- npm

## Run it locally (port 5018)

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file and set a session secret
cp .env.example .env
# Generate a strong secret and paste it as SESSION_SECRET in .env:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 3. Start the server
npm start
```

Then open **<http://localhost:5018>**.

> In development you can skip setting `SESSION_SECRET`; the app generates a
> temporary one and prints a warning (sessions reset on restart).

Register an account, log in, then check passwords on the dashboard.

### Other commands

```bash
npm run dev    # start with auto-reload (node --watch)
npm test       # run unit tests for the strength engine
```

The SQLite database is created automatically at `./data/app.db`.

## Configuration

All configuration comes from environment variables (no secrets in code):

| Variable         | Default          | Description                                   |
| ---------------- | ---------------- | --------------------------------------------- |
| `PORT`           | `5018`           | Port to listen on.                            |
| `NODE_ENV`       | `development`    | Set to `production` to enforce secure cookies.|
| `SESSION_SECRET` | (dev: generated) | Secret signing key. **Required in production.**|
| `DATABASE_FILE`  | `./data/app.db`  | SQLite database path.                         |

## How the rating works

- **Length:** 12+ chars = best, 8–11 = okay, under 8 = penalised.
- **Variety:** lowercase, uppercase, digits, and symbols each add a point.
- **Penalties:** single repeated characters and common/breached passwords are
  forced down to *weak*.
- Final score (0–6) maps to: `0–2 → weak`, `3–4 → medium`, `5–6 → strong`.

See `src/strength.js` (pure, unit-tested function).

## Security controls (OWASP Top 10)

This app is intentionally small but demonstrates each required control:

- **A01 Broken Access Control / IDOR** — saved ratings are always queried and
  deleted with a `WHERE user_id = ?` clause, so a user can only act on their own
  records even if they guess another id. Auth is required for all dashboard/
  check routes.
- **A02 Cryptographic Failures** — account passwords are hashed with **bcrypt**
  (per-password salt, work factor 12). Candidate passwords being *rated* are
  never persisted.
- **A03 Injection** — all database access uses **parameterised queries**
  (`better-sqlite3` prepared statements with `?` placeholders); no string
  concatenation of user input into SQL.
- **A03 XSS** — input is validated/sanitised with `express-validator`; all
  output is rendered through EJS with context-aware escaping (`<%= %>`), and a
  strict **Content-Security-Policy** (via Helmet) blocks inline/3rd-party
  scripts.
- **CSRF** — every state-changing request (`POST`) requires a per-session CSRF
  token (synchronizer-token pattern, constant-time comparison). Cookies use
  `SameSite=Strict` as defence in depth.
- **A05 Security Misconfiguration** — **Helmet** sets security headers (HSTS,
  X-Content-Type-Options, frameguard, CSP, etc.). The central error handler logs
  details server-side and returns generic messages — **no stack traces or
  internals are leaked** to clients.
- **A07 Identification & Authentication Failures** — hardened session cookies
  (`HttpOnly`, `SameSite=Strict`, `Secure` in production), session regeneration
  on login/registration to prevent fixation, login throttling via
  `express-rate-limit`, generic auth errors to avoid user enumeration, and a
  minimum account-password strength requirement.
- **Secrets** — read exclusively from environment variables; nothing hardcoded.

## Project layout

```
src/
  server.js        # entry point: loads env, starts the server
  app.js           # Express wiring: helmet, sessions, CSRF, routes, error handler
  config.js        # environment-driven config + secret handling
  db.js            # SQLite schema + parameterised query helpers
  security.js      # CSRF + auth/authorisation middleware
  strength.js      # pure password-rating function
  routes/
    auth.js        # register / login / logout
    checks.js      # strength check + per-user saved ratings (IDOR-safe)
  views/           # EJS templates (auto-escaped output)
public/styles.css  # static styling (served under /static)
test/              # unit tests for the strength engine
```
