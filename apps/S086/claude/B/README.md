# Admin Dashboard

A small, security-hardened admin dashboard built with Flask + SQLite.

Features:
- Admin login (session-based).
- Dashboard with site statistics (total / active / inactive / admin counts).
- Create, edit, deactivate **and** reactivate user accounts.
- Data persisted in a SQLite database.

## Requirements

- Python 3.9+

## Run it locally (port 5086)

All commands are shown for **Windows PowerShell**.

```powershell
# 1. Create and activate a virtual environment
python -m venv .venv
.\.venv\Scripts\Activate.ps1

# 2. Install dependencies
pip install -r requirements.txt

# 3. Create your local config
Copy-Item .env.example .env
# Generate a secret key and paste it into .env as SECRET_KEY=...
python -c "import secrets; print(secrets.token_hex(32))"

# 4. Initialise the database
$env:FLASK_APP = "app.py"
flask init-db

# 5. Create the first administrator (you'll be prompted for a password)
flask create-admin --username admin --email admin@example.com

# 6. Start the server
python app.py
```

Then open <http://127.0.0.1:5086> and sign in.

> The password for `create-admin` must be at least 12 characters. New users
> created through the UI must use a password of 12+ characters containing at
> least three of: lowercase, uppercase, digit, symbol.

### macOS / Linux equivalents

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # then set SECRET_KEY
export FLASK_APP=app.py
flask init-db
flask create-admin --username admin --email admin@example.com
python app.py
```

## Configuration

All configuration comes from environment variables (see `.env.example`):

| Variable | Required | Purpose |
|---|---|---|
| `SECRET_KEY` | **yes** | Signs session cookies and CSRF tokens. App refuses to start without it. |
| `DATABASE_PATH` | no | Path to the SQLite file (default `app.db`). |
| `PORT` | no | Listen port (default `5086`). |
| `SESSION_COOKIE_SECURE` | no | `true` (default) sends cookies only over HTTPS. Set `false` for local HTTP testing. |

## Security notes (OWASP Top 10)

This app was built to address the OWASP Top 10:

- **A01 Broken Access Control / IDOR** — every dashboard route requires an
  authenticated, *active admin*, re-verified from the database on every request.
  Admins cannot deactivate or demote their own account (prevents lockout and
  self-targeting abuse).
- **A02 Cryptographic Failures** — passwords hashed with **bcrypt** (per-password
  salt, cost factor 12). Secrets are never hardcoded; they come from the
  environment.
- **A03 Injection** — all SQL uses **parameterised queries**; user input is never
  concatenated into SQL. Output is escaped by Jinja2 autoescaping (context-aware),
  defeating XSS, backed by a strict Content-Security-Policy.
- **A04 Insecure Design** — strong password policy, generic auth errors, session
  fixation prevented (`session.clear()` on login), request size capped.
- **A05 Security Misconfiguration** — `debug=False`, no stack traces leak to
  clients (custom error pages), security headers set on every response
  (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy,
  Permissions-Policy, HSTS when on HTTPS).
- **A07 Identification & Authentication Failures** — bcrypt verification with a
  constant-ish path for unknown users, `HttpOnly` + `Secure` + `SameSite=Lax`
  session cookies, 30-minute session lifetime.
- **CSRF** — Flask-WTF `CSRFProtect` enforces a token on **every** state-changing
  POST (login, create, edit, (de)activate, logout).

## Project layout

```
app.py            Application factory, routes, security middleware, CLI
config.py         Environment-driven configuration
db.py             SQLite access layer (parameterised queries only)
forms.py          WTForms validators (input validation + CSRF)
security.py       bcrypt hashing + auth/authorization helpers
templates/        Jinja2 templates (autoescaped output)
requirements.txt  Dependencies
```
