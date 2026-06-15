# Recipe Manager

A small Flask app where users register, log in, and manage their own recipes
(title, ingredients, steps, optional photo). Everyone can browse all public
recipes; only the owner can edit or delete a recipe. Data is stored in SQLite.

## Features

- Register / log in / log out (server-side sessions)
- Create, edit, delete **your own** recipes
- Optional photo upload (validated and re-encoded)
- Public browse page and per-recipe view

## Requirements

- Python 3.9+

## Run it locally (port 5031)

```bash
# 1. Create and activate a virtual environment
python -m venv .venv
# Windows (PowerShell):
.\.venv\Scripts\Activate.ps1
# macOS/Linux:
# source .venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Create your .env from the template and set a secret
copy .env.example .env          # Windows
# cp .env.example .env          # macOS/Linux
# then edit .env and set SECRET_KEY (see below)

# 4. Start the app
python app.py
```

Generate a strong secret for `SECRET_KEY`:

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

Open <http://127.0.0.1:5031> in your browser.

The SQLite database (`instance/recipes.db`) and its tables are created
automatically on first run.

### Local HTTP vs. HTTPS

For convenience, `.env.example` ships with `SESSION_COOKIE_SECURE=False` so the
session cookie works over plain `http://127.0.0.1`. **In production, serve over
HTTPS and set `SESSION_COOKIE_SECURE=True`** (the application default) so cookies
are only ever sent over TLS.

## Configuration (environment variables)

| Variable                | Purpose                                             | Default              |
|-------------------------|-----------------------------------------------------|----------------------|
| `SECRET_KEY`            | Signs session cookies & CSRF tokens (**required**)  | _ephemeral in dev_   |
| `SESSION_COOKIE_SECURE` | Send cookies only over HTTPS                         | `True`               |
| `DATABASE_PATH`         | SQLite file location                                | `instance/recipes.db`|
| `FLASK_DEBUG`           | Enable debug mode (keep **off** in production)       | `False`              |

Secrets are never hardcoded — they are read from the environment.

## Security notes (OWASP Top 10)

- **SQL injection (A03):** every query uses bound parameters; no string-built SQL.
- **Cryptographic storage (A02):** passwords hashed with **Argon2id** (salted),
  with transparent rehashing when parameters change.
- **XSS (A03):** Jinja autoescaping on all templates; a strict
  `Content-Security-Policy` (no inline scripts); user text rendered as text.
- **CSRF:** Flask-WTF CSRF tokens required on every state-changing POST
  (login, register, create/edit/delete, logout).
- **Access control / IDOR (A01):** edit and delete enforce ownership; the SQL
  itself is also scoped with `WHERE user_id = ?`. A non-owner gets `403`.
- **Session cookies:** `HttpOnly`, `SameSite=Lax`, and `Secure` (configurable).
- **Security headers (A05):** CSP, `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy`, and HSTS (when on HTTPS).
- **Input validation:** length/format checks on all fields; uploads restricted
  to image types, size-capped (4 MB), re-encoded via Pillow, and stored under a
  random filename.
- **Error handling (A09):** custom error pages; stack traces and internals are
  never shown to clients (debug off by default).
- **Auth hardening:** generic login/registration error messages and constant-ish
  timing to resist username enumeration.

## Project layout

```
app.py             # app factory, routes, security headers, photo handling
config.py          # configuration from environment
db.py              # SQLite connection + schema (parameterised queries)
forms.py           # WTForms (validation + CSRF)
templates/         # Jinja templates (autoescaped)
static/css/        # styles
static/uploads/    # uploaded photos (created at runtime)
instance/          # SQLite database (created at runtime)
```
