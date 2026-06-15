# Secure FAQ App

A small Node.js / Express application for managing a Frequently Asked Questions
knowledge base.

- **Editors** log in to a private admin area where they can **add, edit, delete,
  and reorder** question-and-answer pairs.
- The **public page** displays all FAQs **grouped by category** with a
  **keyword filter**.
- Data is stored in a **SQLite** database (created automatically — no external
  database server required).

The app is built with security as a first-class concern (see
[Security](#security) below).

---

## Requirements

- **Node.js 18+** (tested on Node 24)
- npm

## Run it locally (port 5041)

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file from the template
cp .env.example .env        # on Windows PowerShell: Copy-Item .env.example .env

# 3. (Recommended) set a strong session secret in .env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
#   -> paste the output as SESSION_SECRET in .env

# 4. Start the server
npm start
```

Then open <http://localhost:5041>.

The listening port is controlled by `PORT` in `.env` and defaults to **5041**.

### First login

On first start the app seeds a single editor account and prints its credentials
to the console:

- **Username:** value of `SEED_ADMIN_USERNAME` (default `editor`)
- **Password:** value of `SEED_ADMIN_PASSWORD` if you set one; otherwise a
  strong random password is generated and **printed once** in the startup log.

Log in at <http://localhost:5041/login>, then use **Manage** to create FAQs.
They appear immediately on the public home page.

> The SQLite file lives at `DATABASE_FILE` (default `./data/faq.db`) and is
> git-ignored. Delete it to start from a clean slate.

---

## Configuration (`.env`)

| Variable              | Purpose                                              | Default        |
| --------------------- | ---------------------------------------------------- | -------------- |
| `PORT`                | HTTP port                                            | `5041`         |
| `NODE_ENV`            | `development` or `production`                         | `development`  |
| `SESSION_SECRET`      | Secret used to sign session cookies (**required in prod**) | random in dev |
| `COOKIE_SECURE`       | Send cookies only over HTTPS (`true`/`false`)        | matches NODE_ENV |
| `SEED_ADMIN_USERNAME` | Username for the seeded editor                       | `editor`       |
| `SEED_ADMIN_PASSWORD` | Password for the seeded editor (random if blank)     | _(blank)_      |
| `DATABASE_FILE`       | Path to the SQLite database file                     | `./data/faq.db`|

No secrets are hardcoded; everything sensitive is read from the environment.

---

## Project layout

```
src/
  server.js              app wiring, security headers, sessions, error handling
  config.js              environment-driven configuration
  db.js                  SQLite connection, schema, first-run seeding
  models.js              parameterised data-access layer
  middleware/
    security.js          CSRF (synchronizer token), auth guards
    validators.js        input validation / bounds (express-validator)
  routes/
    public.js            public, filterable FAQ page
    auth.js              login / logout
    admin.js             editor CRUD + reorder (ownership enforced)
views/                   EJS templates (auto-escaped output)
public/css/style.css     static styles
```

---

## Security

The app applies OWASP Top 10 best practices:

- **SQL injection** — every query uses parameter placeholders
  (`better-sqlite3` prepared statements); no string concatenation of input.
- **Password storage** — passwords are hashed with **bcrypt** (cost 12, salted).
- **Input validation & sanitisation** — `express-validator` enforces type,
  length, and character-set rules on all submitted fields; bodies are size-bounded.
- **XSS** — output is rendered through EJS `<%= %>` context-aware HTML escaping;
  a strict **Content-Security-Policy** (no inline scripts) adds defence in depth.
- **CSRF** — a per-session synchronizer token is required on every
  state-changing request (create/update/delete/reorder/login/logout), verified
  with a constant-time comparison; cookies also use `SameSite=Lax`.
- **Access control / IDOR** — every admin query is scoped to the logged-in
  editor's `author_id`, so editors can only view or modify their own FAQs.
  Unauthorised IDs return 404, never another user's data.
- **Secure session cookies** — `HttpOnly`, `SameSite=Lax`, and `Secure`
  (enabled via `COOKIE_SECURE` when served over HTTPS); session IDs are
  regenerated on login to prevent fixation.
- **Security headers** — set via **Helmet** (CSP, `X-Content-Type-Options`,
  `X-Frame-Options`/`frame-ancestors`, Referrer-Policy, etc.).
- **No information leakage** — a central error handler logs full details
  server-side and returns generic messages; stack traces are never sent to clients.
- **Brute-force protection** — login attempts are rate-limited, with generic
  failure messages to avoid user enumeration.
- **No hardcoded secrets** — all secrets come from environment variables.

### Notes for production

- Set `NODE_ENV=production`, a strong `SESSION_SECRET`, and `COOKIE_SECURE=true`.
- Terminate TLS in front of the app (the app trusts one proxy hop in production).
```
