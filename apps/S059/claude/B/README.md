# Room Reservation System

A small, security-focused room-booking web app built with **Node.js + Express**.
Logged-in users see per-day availability for a set of rooms, book a room for an
hourly time slot, and view/cancel their own bookings. Double-booking the same
room + date + slot is prevented at the database level.

Data is stored in **SQLite** via Node's built-in `node:sqlite` module — so there
are **no native build tools and no external database server required**.

---

## Requirements

- **Node.js ≥ 22.5** (the app uses the built-in `node:sqlite`; developed/tested
  on Node 24). Check with `node --version`.
- npm (ships with Node).

## Run it locally on port 5059

```bash
# 1. Install dependencies
npm install

# 2. Create your local environment file
cp .env.example .env        # Windows PowerShell: copy .env.example .env

# 3. Set a session secret in .env (generate a strong one):
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
#   ...paste the output as SESSION_SECRET=... in .env

# 4. Start the server
npm start
```

Then open <http://localhost:5059>.

The SQLite database is created automatically at `./data/reservations.db` on first
run, the rooms are seeded, and (in development) a demo account is created:

| Username | Password       |
| -------- | -------------- |
| `demo`   | `Password123!` |

You can also register your own account from the **Register** page.

> **Port:** defaults to `5059`. Override with `PORT` in `.env` if needed.

---

## How to use

1. **Log in** (or register).
2. On the **Availability** page, pick a date. The grid shows every room across
   the hourly slots. Green cells are free, blue are yours, grey are taken.
3. Click **Book** on a free cell to reserve it.
4. Go to **My bookings** to review and **Cancel** any of your reservations.

---

## Project layout

```
src/
  config.js              env/config + slot & room-horizon definitions
  db.js                  schema, indexes, seed data (node:sqlite)
  app.js                 Express app: security, sessions, CSRF, routes
  server.js              HTTP server bootstrap
  middleware/
    auth.js              requireAuth + current-user exposure
    csrf.js              synchronizer-token CSRF protection
  routes/
    auth.js              register / login / logout
    bookings.js          availability / book / list / cancel
views/                   EJS templates (auto-escaped output)
public/style.css         styling (served from /static)
```

---

## Security measures (OWASP Top 10)

This app was built to address the OWASP Top 10. Highlights:

- **A01 Broken Access Control / IDOR** — every booking route requires auth; cancel
  is scoped with `DELETE ... WHERE id = ? AND user_id = ?`, so a user can only
  ever act on their own bookings. A foreign id simply affects zero rows.
- **A02 Cryptographic Failures** — passwords are hashed with **bcrypt**
  (`bcryptjs`, cost 12, per-password salt). Session cookies are `HttpOnly`,
  `SameSite=Lax`, and `Secure` in production. Secrets are read from environment
  variables — nothing is hardcoded.
- **A03 Injection (SQLi)** — **all** SQL uses parameterised prepared statements;
  no string concatenation of user input. Slots and dates are also validated
  against an allow-list / strict format.
- **A03 Injection (XSS)** — input is validated/sanitised with `express-validator`;
  output is context-aware HTML-escaped by EJS (`<%= %>`). A strict
  **Content-Security-Policy** (no inline scripts) is set via Helmet.
- **A04 Insecure Design** — double-booking is impossible by design via a
  `UNIQUE(room_id, date, slot)` constraint enforced atomically by the DB, even
  under concurrent requests.
- **A05 Security Misconfiguration** — **Helmet** sets security headers (CSP, HSTS
  in production, `X-Content-Type-Options`, `frame-ancestors 'none'`, etc.).
  Errors are handled centrally; **stack traces and internal errors are never sent
  to clients**.
- **A07 Identification & Authentication Failures** — generic login errors prevent
  user enumeration, a constant-work hash compare reduces timing leaks, sessions
  are **regenerated on login/registration** (anti session-fixation), and login/
  registration are **rate-limited**.
- **CSRF** — all state-changing requests (`POST`) carry a per-session
  synchronizer token validated with a constant-time comparison; `SameSite`
  cookies add defense in depth.

### A note on `Secure` cookies in local dev

`Secure` cookies are only sent over HTTPS. For convenience, local development
(`NODE_ENV=development`) serves over plain HTTP, so the `Secure` flag is **off**
locally and **on** automatically when `NODE_ENV=production` (behind HTTPS). Set
`NODE_ENV=production` and serve via TLS/your reverse proxy in deployment.

---

## Configuration reference

| Variable         | Default                     | Purpose                                   |
| ---------------- | --------------------------- | ----------------------------------------- |
| `PORT`           | `5059`                      | HTTP port                                 |
| `NODE_ENV`       | `development`               | `production` enables Secure cookies + HSTS|
| `SESSION_SECRET` | *(required in production)*  | Signs the session cookie                  |
| `DATABASE_FILE`  | `./data/reservations.db`    | SQLite file location                      |
```
