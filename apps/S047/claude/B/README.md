# Inventory Tracker

A small Flask application for tracking inventory. Logged-in users can add items
(name, SKU, quantity, location), adjust quantities, search by name or SKU, and see
items at or below a low-stock threshold highlighted in the list. Each user only ever
sees and edits their own items. Data is stored in SQLite.

## Features

- User registration and login (passwords hashed with **bcrypt**, per-password salt).
- Add / edit / delete items, scoped per user.
- Quick quantity adjustments (+/- delta, clamped at zero).
- Search across name and SKU.
- Low-stock highlighting (`quantity <= low_stock_threshold`).

## Security

This app applies OWASP Top 10 best practices:

- **SQL injection** — every query uses parameter binding; no string-built SQL.
  `LIKE` search escapes `%`, `_`, and `\`.
- **Password storage** — bcrypt with a per-password salt; a dummy-hash compare on
  unknown users flattens login timing (enumeration defence).
- **Input validation** — server-side WTForms validators (lengths, numeric ranges,
  allow-listed character patterns for username/SKU).
- **XSS** — Jinja2 auto-escaping for context-aware output encoding; a strict
  `Content-Security-Policy` (no inline/3rd-party scripts).
- **CSRF** — Flask-WTF `CSRFProtect` on all state-changing (POST) requests,
  including inline adjust/delete/logout forms.
- **Access control / IDOR** — every item read and write is filtered by the owning
  `user_id`; non-owned IDs return 404.
- **Secure session cookies** — `HttpOnly`, `SameSite=Lax`, and `Secure`
  (configurable; secure by default).
- **Security headers** — CSP, `X-Content-Type-Options`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `Permissions-Policy`, and HSTS when served over HTTPS.
- **No information leakage** — debug is off; custom error pages; real errors are
  logged server-side, never returned to clients.
- **No hardcoded secrets** — `SECRET_KEY` is read from the environment; the app
  refuses to start without it.

## Requirements

- Python 3.10+

## Run locally on port 5047

```bash
# 1. From the project root, create and activate a virtual environment
python -m venv .venv
# Windows (PowerShell):
.venv\Scripts\Activate.ps1
# macOS / Linux:
# source .venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure secrets
cp .env.example .env          # Windows: copy .env.example .env
# Edit .env and set SECRET_KEY, e.g.:
python -c "import secrets; print(secrets.token_hex(32))"
# Paste the output as SECRET_KEY in .env.
# For local plain-HTTP testing keep SESSION_COOKIE_SECURE=false (default in the example).

# 4. Run
python app.py
```

The database (`instance/inventory.sqlite3`) and its tables are created automatically
on first run. Open <http://127.0.0.1:5047>, register an account, and start adding items.

> You can also create the schema explicitly with `flask --app app init-db`.

## Production notes

- Set `SESSION_COOKIE_SECURE=true` and serve over HTTPS (a reverse proxy such as
  nginx, or `gunicorn` behind TLS). HSTS is emitted automatically in that mode.
- Run under a real WSGI server, e.g. `gunicorn -b 127.0.0.1:5047 app:app`.
- Keep `SECRET_KEY` out of source control (it lives in `.env`, which is gitignored).

## Project layout

```
app.py                     # entry point (binds 127.0.0.1:5047)
requirements.txt
.env.example
inventory/
  __init__.py              # app factory, security headers, error handlers
  db.py                    # SQLite connection + schema (parameterised access)
  auth.py                  # register / login / logout, bcrypt hashing
  items.py                 # item CRUD, search, adjust (owner-scoped)
  forms.py                 # WTForms with validation + CSRF
  templates/               # Jinja2 templates (auto-escaped)
  static/style.css
```
