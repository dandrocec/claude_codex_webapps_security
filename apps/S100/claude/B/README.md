# DevOps Dashboard

A small but complete DevOps control panel built with **Node.js + Express**.
Operators register services, define deployment steps (shell commands), trigger
deployments, watch logs stream live and review them later, and manage encrypted
per‑service environment secrets. Two roles are supported: **viewer** (read‑only)
and **operator** (manage their own services and deploy).

All configuration and logs are stored in a local **SQLite** database.

---

## Features

- **Accounts & roles** — register/login; `viewer` (read‑only) and `operator`.
- **Services** — operators register services with a repo URL, description, and
  an ordered list of deployment steps.
- **Deployments** — run the steps sequentially as shell commands; a non‑zero
  exit aborts the run. Per‑service secrets are injected as environment
  variables for the duration of the run.
- **Live + stored logs** — output streams to the browser over Server‑Sent
  Events and is persisted line‑by‑line so it can be replayed later.
- **Secrets** — stored encrypted at rest (AES‑256‑GCM). Values are write‑only
  from the UI: they are never rendered back, only re‑entered to change.

---

## Requirements

- **Node.js ≥ 18** (developed/tested on Node 24)
- npm

`better-sqlite3` ships prebuilt binaries for common platforms, so no compiler is
usually required. `bcryptjs` is pure JavaScript (no native build).

---

## Run it locally (port 5100)

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file and fill in the two secrets
cp .env.example .env
# then edit .env (see below)

# 3. (optional) initialise the database explicitly — it is also auto-created
npm run init-db

# 4. Start the server
npm start
```

Open <http://localhost:5100>.

### Generating the required secrets

Edit `.env` and set strong random values:

```bash
# SESSION_SECRET — signs session cookies
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# SECRETS_KEY — 32-byte key (64 hex chars) that encrypts stored secrets
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> In **development** the app will start without these (it generates ephemeral
> values and warns you), but stored secrets won't survive a restart and
> sessions reset. In **production** (`NODE_ENV=production`) both are mandatory
> and the app refuses to start without them.

### First steps in the UI

1. Register an **operator** account.
2. Click **Register service**, give it a name, and add a step such as
   `echo "Hello from $GREETING"` (on Windows the steps run via `cmd.exe`).
3. (Optional) Add a secret, e.g. key `GREETING`, value `world`.
4. Click **Deploy now** and watch the logs stream live.
5. Register a second **viewer** account to confirm read‑only access.

---

## Security notes (OWASP Top 10)

This project applies defensive controls throughout:

| Area | Control |
|------|---------|
| **SQL injection** | All queries use better‑sqlite3 **prepared statements with bound parameters**; no SQL is built by string concatenation. |
| **Password storage** | Passwords hashed with **bcrypt** (`bcryptjs`, cost 12) and a per‑hash salt. Login uses a constant dummy‑hash comparison to avoid username‑enumeration timing. |
| **Input validation** | All input validated/normalised server‑side with `express-validator` (length, charset, allow‑lists for role/URL/secret keys). Body size is capped. |
| **XSS** | Output is rendered through EJS with context‑aware HTML escaping (`<%= %>`). Client‑side log rendering uses `textContent` only. A strict **Content‑Security‑Policy** (no inline JS/CSS) is set via Helmet. |
| **CSRF** | Synchronizer‑token pattern: a per‑session token is embedded in every form and verified (constant‑time) on all state‑changing requests. `SameSite=Lax` cookies add defence‑in‑depth. |
| **Access control / IDOR** | Roles enforced by middleware. Every mutating service action re‑loads the resource and checks `owner_id === current user` — operators cannot touch another operator's services. Missing resources return 404 (no existence leak). |
| **Secrets at rest** | Service secrets encrypted with **AES‑256‑GCM**; values never returned to the browser. The encryption key is read from `SECRETS_KEY`. |
| **Session cookies** | `HttpOnly`, `SameSite=Lax`, and `Secure` (in production / when `COOKIE_SECURE=true`). Session IDs are regenerated on login/registration to prevent fixation. |
| **Security headers** | Helmet sets CSP, HSTS (prod), `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, frame‑ancestors `none`, etc. |
| **Error handling** | A central handler logs full details server‑side and returns only a generic message — **no stack traces or internals leak** to clients. |
| **Brute force** | Auth endpoints are rate‑limited. |
| **No hardcoded secrets** | All secrets come from environment variables (`.env` is git‑ignored). |

### Important trust model for deployment steps

Running shell commands **is the core feature** of this tool. The deployment
steps an operator defines are executed as shell commands on the host. This
capability is therefore guarded by **authentication + role + ownership**, not by
trying to sanitise command text. Treat operator accounts as you would trusted
shell users on the machine, and run the app in an isolated/sandboxed
environment. Each step has a 10‑minute timeout.

---

## Project layout

```
src/
  server.js            entry point
  app.js               Express app: helmet, sessions, CSRF, routes, error handler
  config.js            env loading + validation (no hardcoded secrets)
  db/                  schema + migrations (better-sqlite3)
  models/              parameterised data-access (users, services, secrets, deployments)
  lib/                 secretsCrypto, sessionStore, deployRunner, validators
  middleware/          auth (authn/authz) + csrf
  routes/              auth + services/deployments
  views/               EJS templates (auto-escaped)
public/                static CSS/JS (CSP-friendly, no inline code)
```

The SQLite database is created at `data/app.db` on first run.
