# Flask Wiki with Page History

A small wiki where **editors** create and edit pages and **viewers** read them.
Every edit (including the first) is stored as an immutable **revision** that can
be viewed and **restored**. Pages can be marked **editor-only** so viewers can't
see them. Data is stored in SQLite.

## Features

- Two roles: `viewer` (read) and `editor` (create / edit / restore).
- Full revision history per page; restoring a revision creates a *new* revision
  rather than rewriting history.
- Editor-only pages, hidden from viewers and anonymous users.
- Built-in registration and login.

## Requirements

- Python 3.9+

## Run it locally (port 5077)

```bash
# 1. Create a virtual environment
python -m venv .venv
# Windows (PowerShell):
.\.venv\Scripts\Activate.ps1
# macOS / Linux:
# source .venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure a secret (recommended)
cp .env.example .env
python -c "import secrets; print(secrets.token_hex(32))"   # paste into SECRET_KEY in .env

# 4. (Optional) seed demo accounts + a sample page
python seed.py

# 5. Run
python app.py
```

Then open <http://127.0.0.1:5077>.

The SQLite database (`wiki.db`) and tables are created automatically on first
run. If you skip `SECRET_KEY`, a random ephemeral key is used (sessions reset
when the server restarts).

### Demo accounts (after `python seed.py`)

| Username | Password          | Role   |
|----------|-------------------|--------|
| editor   | `editor-pass-123` | editor |
| viewer   | `viewer-pass-123` | viewer |

> These are for local testing only — change or remove them before any real use.

## Environment variables

| Variable         | Purpose                                                        | Default  |
|------------------|----------------------------------------------------------------|----------|
| `SECRET_KEY`     | Signs session cookies. Set a long random value in production.   | random   |
| `SECURE_COOKIES` | `1` adds the `Secure` cookie flag + HSTS (HTTPS only).         | `0`      |
| `PORT`           | Port to listen on.                                             | `5077`   |
| `WIKI_DB_PATH`   | Path to the SQLite file.                                       | `wiki.db`|

> **Local HTTP note:** keep `SECURE_COOKIES=0` for plain `http://127.0.0.1:5077`,
> otherwise the browser will refuse to send the session cookie. Set it to `1`
> only when you serve the app behind HTTPS.

## Security notes (OWASP Top 10)

- **SQL injection (A03):** every query uses parameterised statements (`?`
  placeholders); no string-built SQL. See `db.py`.
- **XSS (A03):** Jinja2 autoescaping provides context-aware output encoding;
  page content is rendered as plain text. A strict Content-Security-Policy
  blocks inline scripts.
- **Passwords (A02):** hashed with **Argon2id** (`argon2-cffi`), salted, with
  automatic rehash-on-login when parameters change.
- **CSRF:** Flask-WTF enforces a CSRF token on every POST (forms and action
  buttons such as logout / restore).
- **Access control / IDOR (A01):** role-based decorators guard editor actions;
  editor-only pages are filtered for viewers; revision lookups are scoped to
  their owning page so IDs can't be tampered across pages.
- **Sessions:** cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` when
  `SECURE_COOKIES=1`.
- **Security headers (A05):** CSP, `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy`, and HSTS over HTTPS.
- **Error handling:** debug is disabled and custom error pages are shown — no
  stack traces or internals leak to clients.
- **Secrets:** read from the environment (`SECRET_KEY`), never hardcoded.
- **Open redirects:** post-login `next` is restricted to same-site relative paths.

## Project layout

```
app.py          # application factory, routes, security headers, error handlers
db.py           # SQLite connection + schema init (parameterised queries)
forms.py        # WTForms (CSRF + input validation)
schema.sql      # table definitions
seed.py         # optional demo data
templates/      # Jinja2 templates (autoescaped)
static/style.css
requirements.txt
```
