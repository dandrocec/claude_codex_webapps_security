# Chirp — a small, security-focused social app

A minimal social network built with **Node.js + Express + SQLite**. Users can:

- register and log in,
- set up a profile (bio),
- follow and unfollow other users,
- post short status updates (≤ 280 characters),
- read a **feed** combining their own posts and posts from people they follow.

The app is server-rendered with EJS and ships with security hardening applied
throughout (see [Security](#security)).

---

## Requirements

- **Node.js 18 or newer** (includes npm).

`better-sqlite3` is used for storage; it installs a prebuilt binary on common
platforms, so no separate database server is required. The SQLite file is
created automatically under `./data/` on first run.

---

## Run it locally (port 5063)

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file
cp .env.example .env        # Windows PowerShell: copy .env.example .env

# 3. Generate a session secret and put it in .env (SESSION_SECRET=...)
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 4. Start the server
npm start
```

Then open <http://localhost:5063>.

> The port is read from `PORT` in `.env` (defaults to **5063**).
> If `SESSION_SECRET` is not set in development, a temporary one is generated and
> a warning is printed (sessions reset on restart). In production
> (`NODE_ENV=production`) the secret is **required** and the app refuses to start
> without it.

### Try it out

1. Open two browsers (or a normal + private window) and register two accounts.
2. From account A, visit account B's profile at `/u/<username>` and click **Follow**.
3. Post updates from both accounts.
4. Account A's feed at `/` now shows its own posts plus account B's.

---

## Project layout

```
src/
  app.js              Express app: security middleware, sessions, routes, error handler
  db.js               SQLite connection + schema (foreign keys, WAL)
  models.js           Prepared, parameterised statements (no string-built SQL)
  middleware/
    auth.js           Session-based authentication + current-user loading
    csrf.js           Synchroniser-token CSRF protection
  routes/
    auth.js           register / login / logout
    users.js          profile, settings, follow / unfollow
    posts.js          create / delete posts
views/                EJS templates (auto-escaped output)
public/style.css      Stylesheet (served from /static)
```

---

## Security

Mapped to the OWASP Top 10 and the stated requirements:

| Area | What was done |
|------|---------------|
| **SQL injection** | All database access uses `better-sqlite3` **prepared statements with bound parameters** (`src/models.js`). No query is built by string concatenation. |
| **Password storage** | Passwords are hashed with **bcrypt** (cost factor 12, per-password salt) via `bcryptjs`. Plaintext passwords are never stored or logged. |
| **Input validation** | `express-validator` validates and normalises every input (username pattern/length, email format, password length, post/bio length) before use. |
| **XSS (output encoding)** | EJS `<%= %>` performs context-aware HTML escaping on all user content. Newlines are preserved with CSS (`white-space: pre-wrap`), never by injecting raw HTML. A strict **Content-Security-Policy** (no inline scripts/styles) provides defence in depth. |
| **CSRF** | A per-session synchroniser token is required on **every** state-changing request (`POST`), verified with a constant-time comparison. `SameSite=Lax` cookies add a second layer. |
| **Access control / IDOR** | Identity always comes from the **server-side session**, never from client input. Users can only delete their **own** posts and edit their **own** profile; ownership is enforced in both the handler and the SQL `WHERE` clause. Missing-vs-forbidden resources both return a generic 404. |
| **Session cookies** | `HttpOnly`, `SameSite=Lax`, and `Secure` (enabled automatically in production). The session id is **regenerated on login/registration** to prevent fixation. |
| **Security headers** | `helmet` sets CSP, `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, frame-ancestors `none` (clickjacking), and related headers. |
| **Error handling** | A centralised error handler returns **generic** messages; stack traces and internals are logged server-side only, never sent to the client. |
| **Secrets** | `SESSION_SECRET` (and `PORT`, `NODE_ENV`) are read from environment variables via `.env`. Nothing sensitive is hardcoded. |
| **Brute force** | Login and registration are rate-limited (`express-rate-limit`). Login responses are deliberately generic to avoid username enumeration. |

### Production notes

- Run behind HTTPS (a TLS-terminating proxy) and set `NODE_ENV=production` so the
  `Secure` cookie flag and `upgrade-insecure-requests` are enabled. `trust proxy`
  is turned on in production so secure cookies work behind a proxy.
- The default `express-session` memory store is fine for local use but not for
  multi-process production; swap in a persistent store (e.g. Redis) before scaling.

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start the server. |
| `npm run dev` | Start with `node --watch` for auto-restart during development. |
