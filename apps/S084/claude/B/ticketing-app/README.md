# Ticketing App

A small but production-minded event ticketing application built with **Node.js + Express** and **SQLite**.

- **Organisers** create events with a fixed number of tickets.
- **Users** register, log in, and buy tickets until an event sells out.
- **Overselling is impossible** — purchases are atomic and guarded at both the query and database-constraint level.
- Users can view **their own purchased tickets**.

## Requirements

- Node.js **18+** (includes npm)
- A C/C++ build toolchain is only needed if `better-sqlite3` has no prebuilt binary for your platform (most Windows/macOS/Linux setups use prebuilds automatically).

## Run it locally (port 5084)

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file
cp .env.example .env          # Windows PowerShell: copy .env.example .env

# 3. (Recommended) generate a session secret and paste it into .env as SESSION_SECRET
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 4. Start the server
npm start
```

Then open <http://localhost:5084>.

The SQLite database is created automatically at `./data/ticketing.db` on first run. No separate database server is required.

> If you skip setting `SESSION_SECRET` in development, the app generates a temporary one and prints a warning (sessions reset on restart). In production (`NODE_ENV=production`) the app refuses to start without it.

## How to use

1. Register an account, then log in.
2. Click **Create event**, give it a name and a ticket capacity.
3. Open an event and click **Buy a ticket**. When tickets run out, the event shows **Sold out** and further purchases are rejected.
4. Visit **My tickets** to see everything you've bought.

## Configuration

All configuration is read from environment variables (see `.env.example`):

| Variable         | Default                  | Purpose                                                        |
| ---------------- | ------------------------ | ------------------------------------------------------------- |
| `PORT`           | `5084`                   | HTTP port.                                                     |
| `SESSION_SECRET` | _(required in prod)_     | Signs session cookies. Never commit a real value.             |
| `NODE_ENV`       | `development`            | `production` enables HSTS, Secure cookies, strict secrets.    |
| `COOKIE_SECURE`  | `false`                  | Set `true` when served over HTTPS so cookies get `Secure`.    |
| `DB_FILE`        | `./data/ticketing.db`    | SQLite database path.                                          |

## How overselling is prevented

Buying a ticket runs inside a single SQLite transaction:

```sql
UPDATE events
SET tickets_sold = tickets_sold + 1
WHERE id = ? AND tickets_sold < capacity;   -- only succeeds while seats remain
```

If the guarded `UPDATE` affects 0 rows, the event is full and no ticket row is inserted. As a final backstop the `events` table carries a `CHECK (tickets_sold <= capacity)` constraint, so the database itself can never hold an oversold state.

## Security measures (OWASP Top 10)

- **SQL injection** — every query uses parameterised statements (`better-sqlite3` prepared statements); no string concatenation of user input.
- **Password storage** — bcrypt with a per-user salt and a cost factor of 12.
- **Input validation** — `express-validator` validates and normalises all input; lengths, formats and types are enforced server-side.
- **XSS** — EJS auto-escapes all interpolated output (`<%= %>`), plus a strict Content-Security-Policy via Helmet (no inline scripts).
- **CSRF** — synchronizer-token pattern: a per-session token is required (and constant-time compared) on every state-changing request; `SameSite=Lax` cookies add defence in depth.
- **Access control / IDOR** — ticket and account queries are always scoped to the authenticated `session.userId`; protected routes require a valid session.
- **Session security** — cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` (in production / when `COOKIE_SECURE=true`); session IDs are regenerated on login and registration to prevent fixation; sessions are stored server-side in SQLite.
- **Security headers** — Helmet sets CSP, `X-Content-Type-Options`, `X-Frame-Options`/`frame-ancestors 'none'`, Referrer-Policy, HSTS (prod), etc.
- **Error handling** — a central handler logs full detail server-side and returns a generic message to clients; no stack traces are exposed.
- **Secrets** — read exclusively from environment variables; nothing sensitive is hardcoded.
- **Brute force** — login and registration endpoints are rate-limited.

## Project structure

```
src/
  app.js              # app wiring, security middleware, error handling
  db.js               # SQLite connection + schema
  middleware/
    auth.js           # session-based access control
    csrf.js           # synchronizer-token CSRF protection
  routes/
    auth.js           # register / login / logout
    events.js         # list/create events, atomic ticket purchase
    tickets.js        # "my tickets"
views/                # EJS templates (auto-escaped)
public/styles.css     # static assets
```
