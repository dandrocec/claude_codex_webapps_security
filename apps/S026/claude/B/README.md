# Flask Blog

A minimal, security-focused blog built with Python and Flask. Users can register,
log in, and create / edit / delete **their own** posts. The home page lists all
posts newest-first, and every post has its own detail page. All data lives in a
local SQLite database.

## Features

- User registration and login (Argon2id-hashed passwords).
- Create, edit, and delete your own posts (title + body).
- Home page listing all posts (newest first) and per-post detail pages.
- SQLite storage created automatically on first run.

## Requirements

- Python 3.9+

## Run it locally (port 5026)

```bash
# 1. From the project directory, create and activate a virtual environment
python -m venv .venv
# Windows (PowerShell):
.venv\Scripts\Activate.ps1
# macOS / Linux:
# source .venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Provide a secret key (required). Generate one:
python -c "import secrets; print(secrets.token_hex(32))"
```

Set the generated value as `SECRET_KEY`, then start the app.

**PowerShell (Windows):**
```powershell
$env:SECRET_KEY = "paste-the-generated-value"
$env:FLASK_DEBUG = "1"   # local http dev only; allows the cookie without https
python app.py
```

**bash / zsh (macOS / Linux):**
```bash
export SECRET_KEY="paste-the-generated-value"
export FLASK_DEBUG=1      # local http dev only; allows the cookie without https
python app.py
```

Then open <http://127.0.0.1:5026>.

> **Why `FLASK_DEBUG=1` locally?** In production the app marks session cookies
> `Secure`, so browsers only send them over HTTPS. On a plain-http dev server
> that would break login. Setting `FLASK_DEBUG=1` relaxes the `Secure` flag for
> local development. **Never set it in production.**

See `.env.example` for all supported environment variables.

## Running in production

- Leave `FLASK_DEBUG` unset (or `0`) and serve behind HTTPS so `Secure` cookies
  and HSTS take effect.
- Run under a WSGI server (e.g. `gunicorn -b 127.0.0.1:5026 app:app`) behind a
  TLS-terminating reverse proxy rather than the built-in dev server.
- Provide `SECRET_KEY` (and optionally `DATABASE_PATH`) via the environment or a
  secrets manager — never commit them.

## Security measures (OWASP Top 10)

| Concern | Mitigation |
|---|---|
| SQL injection | Every query uses parameterised `sqlite3` statements. |
| Password storage | Argon2id (argon2-cffi) with per-password salts; transparent rehash on parameter changes. |
| XSS | Jinja2 autoescaping for context-aware output encoding; strict Content-Security-Policy; post bodies rendered as text (no raw HTML). |
| CSRF | Flask-WTF CSRF tokens required on every POST (login, register, create, edit, delete, logout). |
| Broken access control / IDOR | Edit and delete enforce `author_id == current_user.id`; queries are scoped to the owner. |
| Session security | Cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` (outside debug). |
| Security headers | CSP, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, and HSTS over HTTPS. |
| Error handling | Custom 400/403/404/413/500 pages; no stack traces or internals leak to clients. |
| Secrets management | `SECRET_KEY` and config read from the environment; the app refuses to start without one. |
| Input validation | WTForms validators (length, allowed-character patterns) plus a 1 MB request-body cap. |

## Project layout

```
app.py              # application, models, routes, security config
requirements.txt    # dependencies
.env.example        # documented environment variables
templates/          # Jinja2 templates (autoescaped)
static/style.css    # styling
```
