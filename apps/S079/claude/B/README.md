# Flask Invoicing App

A small multi-user invoicing application. Users register, manage their own
clients, and create invoices with line items. The app computes subtotal, tax,
and total, and renders a printable invoice page. Each user can only see and act
on their own clients and invoices. Data is stored in SQLite.

## Features

- User registration and login (Argon2id password hashing)
- Per-user clients (create / edit / delete)
- Invoices with dynamic line items, automatic subtotal / tax / total
- Printable invoice page (`/invoices/<id>/print`)
- Strict access control — users only ever touch their own resources

## Requirements

- Python 3.9+

## Run locally (port 5079)

```bash
# 1. (recommended) create and activate a virtual environment
python -m venv .venv
# Windows PowerShell:
.\.venv\Scripts\Activate.ps1
# macOS / Linux:
# source .venv/bin/activate

# 2. install dependencies
pip install -r requirements.txt

# 3. set a secret key (see Configuration below)
#    PowerShell:
$env:SECRET_KEY = "change-me-to-a-long-random-value"
#    bash:
# export SECRET_KEY="change-me-to-a-long-random-value"

# 4. run
python app.py
```

Then open <http://127.0.0.1:5079>. The SQLite database is created automatically
on first run under `instance/invoicing.sqlite3`.

You can also run with the Flask CLI:

```bash
flask --app app run --port 5079
# initialise / reset the database tables explicitly:
flask --app app init-db
```

## Configuration (environment variables)

No secrets are hardcoded — everything sensitive comes from the environment.

| Variable                | Default                         | Purpose                                                        |
| ----------------------- | ------------------------------- | ------------------------------------------------------------- |
| `SECRET_KEY`            | random ephemeral (dev only)     | Flask session signing / CSRF. **Set this in production.**      |
| `DATABASE`              | `instance/invoicing.sqlite3`    | Path to the SQLite file.                                       |
| `SESSION_COOKIE_SECURE` | `0`                             | Set to `1` when served over HTTPS so cookies get the `Secure` flag. |
| `FLASK_DEBUG`           | `0`                             | Keep `0`. Debug must stay off so stack traces are never shown. |

If `SECRET_KEY` is not set, a random key is generated at startup so the app is
runnable immediately, but sessions will not survive a restart — always set it
explicitly for anything beyond a quick local trial.

## Security measures (OWASP Top 10)

- **Injection:** all SQL uses parameterised queries (`?` placeholders); no user
  input is concatenated into SQL.
- **Authentication:** passwords hashed with Argon2id (salted, memory-hard);
  generic error messages avoid user enumeration; hashes auto-upgrade on login.
- **Access control / IDOR:** every query is scoped by `user_id`; object lookups
  go through ownership checks that return 404 for resources the user does not own.
- **XSS:** Jinja2 autoescaping is on for all templates; a strict
  `Content-Security-Policy` (`default-src 'self'`, no inline scripts) is set.
- **CSRF:** Flask-WTF `CSRFProtect` protects every state-changing POST,
  including logout and delete actions.
- **Session cookies:** `HttpOnly`, `SameSite=Lax`, and `Secure` (when
  `SESSION_COOKIE_SECURE=1`) are configured.
- **Security headers:** `X-Content-Type-Options`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `Permissions-Policy`, CSP, and HSTS (over HTTPS).
- **Error handling:** debug is off; custom 400/403/404/500 pages never leak
  stack traces or internal details.
- **Input validation:** server-side validation (length, format, numeric ranges)
  on all forms and line items; request body size is capped.
- **Secrets:** read from environment variables, never committed to source.

## Project layout

```
app.py            # application factory, routes, security config
db.py             # SQLite helpers (parameterised queries) + init-db command
forms.py          # WTForms definitions (validation + CSRF)
schema.sql        # database schema
templates/        # Jinja2 templates (autoescaped)
static/           # CSS and JS (served from 'self' for CSP)
requirements.txt
```

## Notes

This app uses Flask's built-in development server, which is appropriate for
local use. For production, run it behind a WSGI server (e.g. gunicorn/uWSGI) and
a TLS-terminating reverse proxy, and set `SECRET_KEY` and
`SESSION_COOKIE_SECURE=1`.
