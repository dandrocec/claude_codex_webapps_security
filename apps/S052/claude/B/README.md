# Support Desk — Flask ticket app

A small support-ticket web app. Registered users log in, submit tickets
(subject, description, priority), and view the status of **their own** tickets.
Data is stored in SQLite.

## Features
- User registration & login (sessions via Flask-Login)
- Submit tickets with subject / description / priority
- List and view your own tickets and their status
- Each user sees only their own tickets

## Requirements
- Python 3.9+

## Run it locally (port 5052)

```bash
# 1. From the project directory, create and activate a virtualenv
python -m venv .venv
# Windows (PowerShell):
.venv\Scripts\Activate.ps1
# macOS / Linux:
# source .venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure environment (a SECRET_KEY is required)
cp .env.example .env            # Windows: copy .env.example .env
# Generate a strong key and paste it into .env as SECRET_KEY=...
python -c "import secrets; print(secrets.token_hex(32))"

# 4. Start the app
python app.py
```

Then open **http://127.0.0.1:5052** , register an account, and log in.

The SQLite database is created automatically at `instance/tickets.sqlite3`
on first run.

> **HTTP vs HTTPS:** session cookies use the `Secure` flag by default, which
> requires HTTPS. For plain-HTTP local testing keep `SESSION_COOKIE_SECURE=false`
> in `.env` (as in `.env.example`). In production, serve over HTTPS and set it
> to `true` (or simply remove it).

## Security controls (OWASP Top 10)

| Area | Implementation |
|------|----------------|
| **A01 Access control / IDOR** | Every ticket route is `@login_required`; ticket queries are scoped by `user_id`, so a user can never read another user's ticket (a foreign id returns 404). |
| **A02 Cryptographic failures** | Passwords hashed with **bcrypt** (per-password salt). `SECRET_KEY` and other secrets come from environment variables — nothing is hardcoded. |
| **A03 Injection** | All SQL uses **parameterised queries** (`?` placeholders). Jinja2 auto-escaping provides context-aware output encoding to prevent **XSS**; a strict Content-Security-Policy backs it up. |
| **A04 Insecure design** | Server-side input validation with allow-lists and length limits (WTForms); request body size capped. |
| **A05 Misconfiguration** | Security headers (CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, COOP, HSTS); secure session cookies (`HttpOnly`, `Secure`, `SameSite=Lax`). |
| **CSRF** | Flask-WTF CSRF tokens required on every state-changing POST (register, login, logout, new ticket). |
| **A07 Auth failures** | Generic "invalid username or password" message + constant-ish work factor to resist user enumeration; strong session protection. |
| **A09 Logging / errors** | Custom 403/404/413/500 pages — stack traces and internal errors are never sent to the client; the real exception is logged server-side. |

## Project layout
```
app.py            # app factory, routes, auth, security headers, error handlers
db.py             # SQLite access layer (parameterised queries)
forms.py          # WTForms with validation + CSRF
templates/        # Jinja2 templates (auto-escaped output)
static/style.css  # styles (no inline CSS, to satisfy CSP)
requirements.txt
.env.example
```
