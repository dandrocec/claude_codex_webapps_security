# Newsletter Manager

A small Flask application where a logged-in **editor** manages a list of
**subscribers** and composes **newsletter drafts** (subject + body). The app
renders a safe preview of how a draft would look in an email client.
Subscribers and drafts are stored in SQLite.

## Features

- Editor login / logout (session-based)
- Add and remove subscribers (email + optional name)
- Create, edit, and delete newsletter drafts
- Live-style **preview** of a draft as it would appear to subscribers
- All data persisted in a local SQLite database

## Requirements

- Python 3.9+ (developed/tested on Python 3.12+)

## Run it locally (port 5049)

```bash
# 1. Create and activate a virtual environment
python -m venv .venv
# Windows (PowerShell):
.venv\Scripts\Activate.ps1
# macOS / Linux:
# source .venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure environment (see .env.example)
#    For plain-HTTP local testing you MUST disable the Secure cookie flag,
#    otherwise the browser will refuse to send the session cookie over http.
```

**Windows (PowerShell):**

```powershell
$env:SECRET_KEY = python -c "import secrets; print(secrets.token_urlsafe(48))"
$env:ADMIN_USERNAME = "editor"
$env:ADMIN_PASSWORD = "change-me-please"
$env:SESSION_COOKIE_SECURE = "0"   # local http only
python app.py
```

**macOS / Linux (bash):**

```bash
export SECRET_KEY="$(python -c 'import secrets; print(secrets.token_urlsafe(48))')"
export ADMIN_USERNAME="editor"
export ADMIN_PASSWORD="change-me-please"
export SESSION_COOKIE_SECURE=0      # local http only
python app.py
```

Then open <http://127.0.0.1:5049> and sign in.

> If you do **not** set `ADMIN_PASSWORD`, a random password is generated on
> first run and printed once to the server console — use it to log in.

The app listens on port **5049** by default (override with `PORT`).

## Configuration (environment variables)

| Variable                | Default          | Purpose                                              |
| ----------------------- | ---------------- | ---------------------------------------------------- |
| `SECRET_KEY`            | ephemeral random | Signs session cookies. **Set this in production.**   |
| `ADMIN_USERNAME`        | `editor`         | Username for the seeded editor (first run only).     |
| `ADMIN_PASSWORD`        | random           | Password for the seeded editor (first run only).     |
| `SESSION_COOKIE_SECURE` | `True`           | Send session cookie over HTTPS only. Set `0` for local http. |
| `PORT`                  | `5049`           | Port to listen on.                                   |
| `DATABASE_PATH`         | `newsletter.db`  | SQLite file location.                                |

## Production notes

Run behind a real WSGI server over HTTPS, e.g.:

```bash
SESSION_COOKIE_SECURE=1 gunicorn -b 127.0.0.1:5049 "app:app"
```

## Security

This app applies OWASP Top 10 best practices:

- **SQL injection (A03):** every query uses parameterised statements.
- **Password storage (A02):** Argon2id hashing with per-password salts (`argon2-cffi`).
- **XSS (A03):** Jinja2 autoescaping is enabled; the draft body is rendered as
  plain text (`white-space: pre-wrap`) and never as raw HTML, so embedded
  markup is displayed literally, not executed.
- **CSRF (A01/A07):** Flask-WTF `CSRFProtect` guards every state-changing
  (POST) request; all forms include a CSRF token.
- **Access control / IDOR (A01):** subscribers and drafts are owned by a user;
  every read/update/delete is scoped to the logged-in user's `id`. Accessing
  another user's resource returns 404.
- **Session cookies:** `HttpOnly`, `SameSite=Lax`, and `Secure` (configurable);
  the session is rotated on login to prevent fixation.
- **Security headers:** `Content-Security-Policy` (no inline scripts / external
  origins), `X-Content-Type-Options`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `Permissions-Policy`, and HSTS when served over HTTPS.
- **Input validation:** emails are validated and normalised; field lengths are
  bounded; control characters are stripped; request body size is capped.
- **No information leakage:** debug mode is off and custom error pages are
  returned — stack traces and internals are never shown to clients.
- **No hardcoded secrets:** all secrets are read from environment variables.

## Project layout

```
app.py                 # application, routes, DB, security config
requirements.txt       # dependencies
.env.example           # sample environment configuration
templates/             # Jinja2 templates (autoescaped)
static/style.css       # styling
```
