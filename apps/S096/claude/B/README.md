# Secure API Gateway

A small but production-shaped API gateway built with Node.js + Express.

Developers **register**, **generate API keys**, and send requests to `/gateway/*`.
Requests carrying a valid key are **proxied to a configured backend**, subject to a
**per-key rate limit**, and every call is **tracked** and shown on a **dashboard**.

Keys and usage are stored in a local **SQLite** database.

---

## Features

- Developer registration & login (sessions)
- API key generation, listing, and revocation
- Reverse proxy to a configurable backend (`BACKEND_URL`)
- Per-key rate limiting (requests/minute), enforced at the gateway
- Usage tracking (method, path, status, latency) with a stats dashboard
- SQLite persistence via prepared statements

## Security (OWASP Top 10)

| Concern | How it's addressed |
| --- | --- |
| **SQL injection** | All DB access uses `better-sqlite3` prepared statements with bound parameters. |
| **Password storage** | Passwords hashed with **bcrypt** (cost 12) + per-hash salt. |
| **Secret storage of keys** | API keys are random 32-byte tokens; only a SHA-256 hash is stored. The plaintext is shown to the developer once. |
| **Input validation** | `express-validator` validates/normalises all form input; lengths bounded. |
| **XSS** | EJS auto-escapes all output (`<%= %>`); strict Content-Security-Policy with no inline scripts. |
| **CSRF** | Synchronizer-token protection on every state-changing request (form field `_csrf` / `X-CSRF-Token` header), constant-time compared. |
| **Access control / IDOR** | Every key/usage query is scoped by the authenticated `user_id`; revoke updates only affect the owner's keys. |
| **Session cookies** | `HttpOnly`, `SameSite=Lax`, signed; `Secure` enabled via `COOKIE_SECURE`/production. Session regenerated on login to stop fixation. |
| **Security headers** | `helmet` (CSP, HSTS, X-Content-Type-Options, frame-ancestors, referrer-policy, etc.). |
| **Error handling** | Central handler logs server-side only; clients get generic messages, never stack traces. |
| **Brute force** | Login/registration throttled with `express-rate-limit`. |
| **Secrets** | Read from environment variables; nothing hardcoded. `.env` is git-ignored. |

---

## Requirements

- Node.js **18+** (developed on Node 24)
- npm

## Run locally on port 5096

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file
cp .env.example .env

# 3. Set a session secret (required) — generate a strong random value:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
#    ...and paste it into SESSION_SECRET in .env

# 4. Start the server
npm start
```

On Windows PowerShell, step 2 is `Copy-Item .env.example .env`.

Then open <http://localhost:5096> and register an account.

> The default `BACKEND_URL` is `https://httpbin.org`, which is handy for testing.
> Point it at your own service for real use.

---

## Using the gateway

1. Register and log in.
2. On the dashboard, generate an API key and **copy it** (shown once).
3. Make proxied requests with the key:

```bash
curl http://localhost:5096/gateway/get \
  -H "x-api-key: gw_your_key_here"
```

`Authorization: Bearer gw_...` is also accepted. The request is forwarded to
`BACKEND_URL` + the path after `/gateway`, and recorded against your key.

Exceeding the key's rate limit returns `429` with a `Retry-After` header.
Watch the requests appear under **Recent activity** on the dashboard.

---

## Configuration (`.env`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `5096` | Listen port |
| `NODE_ENV` | `development` | `production` enforces `SESSION_SECRET` and secure cookies |
| `SESSION_SECRET` | _(required)_ | Signs session cookies |
| `COOKIE_SECURE` | `false` | Force `Secure` cookie flag (set `true` behind HTTPS) |
| `BACKEND_URL` | `https://httpbin.org` | Upstream the gateway proxies to |
| `DEFAULT_RATE_LIMIT` | `60` | Default req/min for new keys |
| `DB_PATH` | `./data/gateway.db` | SQLite file location |

## Project layout

```
src/
  app.js              Express app wiring + security middleware
  server.js           Entry point (listens on PORT)
  config.js           Env-driven configuration
  db.js               SQLite connection + schema
  middleware/         auth, csrf, error handling
  routes/             auth, dashboard, keys, gateway (proxy)
  services/           users, apiKeys, usage (data access)
views/                EJS templates (auto-escaped)
public/               styles.css, app.js (static assets)
```

## Notes for production

- Sessions use the in-memory store (fine for local dev). Use a persistent store
  (Redis, etc.) behind multiple instances.
- Run behind HTTPS and set `COOKIE_SECURE=true` (or `NODE_ENV=production`).
- Rate limiting is per-process; use a shared store for horizontally scaled deployments.
