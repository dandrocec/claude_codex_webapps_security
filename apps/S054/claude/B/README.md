# Time Tracker

A small Flask app for logging time entries (project, date, hours, note) and
viewing **weekly totals**. Each user authenticates and sees **only their own**
entries. Data is stored in SQLite.

## Features

- Register / log in / log out
- Add and delete time entries (project, date, hours, note)
- Per-project and grand weekly totals, with previous/next week navigation
- Strict per-user data isolation

## Requirements

- Python 3.10+ (tested on 3.14)

## Run it locally (port 5054)

```bash
# 1. Create & activate a virtual environment
python -m venv .venv
# Windows (PowerShell):
.venv\Scripts\Activate.ps1
# macOS / Linux:
source .venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure environment
cp .env.example .env          # Windows: copy .env.example .env
# Generate a secret key and paste it into .env as SECRET_KEY:
python -c "import secrets; print(secrets.token_hex(32))"
```

Your `.env` should contain at least:

```
SECRET_KEY=<the value you generated>
SESSION_COOKIE_SECURE=false   # required for plain-HTTP localhost testing
```

```bash
# 4. Start the app on port 5054
python app.py
# (equivalent: flask --app app run --port 5054)
```

Open <http://localhost:5054>, register an account, and start logging time.
The SQLite database (`timetracker.db`) and tables are created automatically on
first run.

> **Note on `SESSION_COOKIE_SECURE`:** in production (HTTPS) leave it unset so
> it defaults to `true`. Over plain HTTP on localhost it must be `false`,
> otherwise the browser refuses to send the session cookie and you can't log in.

## Security measures (OWASP Top 10)

| Area | Implementation |
|------|----------------|
| **SQL injection (A03)** | Every query uses parameterised `?` bindings (`db.py`, `app.py`). No string-built SQL. |
| **Password storage (A02/A07)** | Argon2id via `argon2-cffi` — strong, salted, with automatic rehash-on-login. |
| **Input validation (A03/A04)** | WTForms validators: length, regex whitelist for usernames, numeric range for hours, date parsing. |
| **XSS (A03)** | Jinja2 autoescaping (context-aware output encoding) on all rendered values; strict CSP forbids inline/3rd-party scripts. |
| **CSRF (A01)** | Flask-WTF `CSRFProtect` on every POST (forms + logout/delete include tokens). |
| **Access control / IDOR (A01)** | All entry queries are scoped by `user_id` from the session; delete verifies ownership and returns 403 otherwise. |
| **Secure session cookies (A05)** | `HttpOnly`, `SameSite=Lax`, and `Secure` (configurable) cookie flags; 8-hour lifetime; session fixation avoided via `session.clear()` on login. |
| **Security headers (A05)** | CSP, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, HSTS (when Secure). |
| **Error handling (A05/A09)** | Custom error pages; stack traces never sent to clients; `debug=False`. Real errors logged server-side. |
| **Secrets management (A05)** | `SECRET_KEY` and config read from environment; app refuses to start without a secret. No hardcoded secrets. |
| **Open redirect** | `next` redirect target restricted to local paths only. |

## Project layout

```
app.py            # app factory, routes, auth, security headers, error handlers
config.py         # env-driven configuration & cookie hardening
db.py             # SQLite connection + schema (parameterised access)
forms.py          # WTForms (validation + CSRF)
templates/        # Jinja2 templates (autoescaped)
static/style.css  # styles (external; no inline styles per CSP)
requirements.txt
.env.example
```
