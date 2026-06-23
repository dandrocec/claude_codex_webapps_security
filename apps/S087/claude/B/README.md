# Multi-Tenant SaaS Skeleton (FastAPI)

A minimal but production-shaped multi-tenant SaaS starter.

- **Organisations** sign up; the first user becomes the organisation **admin**.
- Each organisation has its own **users** and its own **data** (sample resource:
  *projects*). Data is strictly isolated per tenant — users of one organisation
  can never see another organisation's data.
- **Org-scoped login**: you authenticate with an organisation *slug* + email +
  password, so identical emails can exist in different organisations.
- **Roles**: `admin` (manage org users, see all org projects) and `member`
  (manage only their own projects).
- Data is stored in a relational database via SQLAlchemy (SQLite by default).

## Tech stack

FastAPI · SQLAlchemy 2 · Jinja2 (server-rendered) · bcrypt · Starlette sessions.

## Run locally on port 5087

Requires Python 3.11+.

```bash
# 1. Create and activate a virtual environment
python -m venv .venv
# Windows (PowerShell):
.venv\Scripts\Activate.ps1
# macOS / Linux:
# source .venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure environment (secrets are read from env vars, never hardcoded)
cp .env.example .env          # Windows: copy .env.example .env
#   then edit .env and set a strong SECRET_KEY
#   generate one with:  python -c "import secrets; print(secrets.token_urlsafe(48))"

# 4. Start the server on port 5087
uvicorn app.main:app --host 127.0.0.1 --port 5087
```

Then open <http://127.0.0.1:5087>. The SQLite database and tables are created
automatically on first start.

> Note: `.env.example` ships with `SESSION_COOKIE_SECURE=false` so cookies work
> over plain HTTP on localhost. **Set it to `true` in any HTTPS/production
> deployment** so the session cookie carries the `Secure` flag.

## Try it

1. Go to **Sign up**, create an organisation (e.g. "Acme"). You'll get a login
   slug like `acme` and become its admin.
2. Log in with that slug + your email + password.
3. Create a **project**, then visit **Users** to add members or more admins.
4. Sign up a *second* organisation and confirm its users see none of the first
   organisation's projects or users.

## Security controls (OWASP Top 10)

| Area | Implementation |
|------|----------------|
| **A01 Broken Access Control / IDOR** | Every query is filtered by `org_id`. A single `_load_owned_project` chokepoint enforces tenant scope plus per-member ownership, so guessed IDs return 404. Admin routes are gated by an explicit role check. Admins can only ever act within their own org. |
| **A02 Cryptographic Failures** | Passwords hashed with **bcrypt** (per-password random salt, adaptive cost). Sessions held in a signed cookie set `HttpOnly`, `SameSite=Lax`, and `Secure` (when `SESSION_COOKIE_SECURE=true`). |
| **A03 Injection** | All DB access goes through the SQLAlchemy ORM, which uses **bound parameters** — no string-built SQL. Jinja2 **autoescaping** is on, giving context-aware output encoding against XSS. |
| **A04 Insecure Design** | Tenancy enforced at the data layer; generic auth-failure messages avoid account enumeration. |
| **A05 Security Misconfiguration** | Strict security headers (`Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS over HTTPS). Interactive API docs disabled. |
| **A05 / Error handling** | Custom exception handlers return generic pages; **stack traces and internals are logged server-side, never sent to clients**. |
| **A07 Auth Failures** | Org-scoped login; **CSRF tokens** (synchronizer pattern, constant-time compare) required on every state-changing `POST`; session is reset on login to prevent fixation; password length bounds enforced. |
| **Secrets** | `SECRET_KEY`, `DATABASE_URL`, etc. are read from environment variables; the app refuses to start without a sufficiently long `SECRET_KEY`. |
| **Input validation** | All form input is validated/normalised server-side (emails via `email-validator`, length bounds, slug allow-list, role allow-list) before use. |

## Project layout

```
app/
  main.py         # FastAPI app, routes, middleware, exception handlers
  config.py       # env-driven settings
  database.py     # engine + session
  models.py       # Organisation, User, Project (org_id on every tenant row)
  security.py     # bcrypt hashing, CSRF tokens, input validation
  deps.py         # auth/role/CSRF dependencies
  templating.py   # Jinja2 (autoescaping) + flash messages
  templates/      # server-rendered HTML
  static/         # CSS
requirements.txt
.env.example
```

## Production notes

- Point `DATABASE_URL` at Postgres/MySQL and run behind HTTPS with
  `SESSION_COOKIE_SECURE=true`.
- Add rate limiting on `/login` and `/signup`, plus account lockout/MFA.
- Use a migration tool (Alembic) instead of `create_all` for schema changes.
