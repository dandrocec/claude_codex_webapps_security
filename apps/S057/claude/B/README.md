# Tiny Shop

A small online shop built with Flask and SQLite, written to demonstrate
OWASP Top 10 best practices.

## Features

- **Catalogue page** listing products (name, price, description).
- **Product page** where logged-in visitors post comments that are stored in
  the database and displayed.
- **Session-based shopping cart** with a running total.
- **User accounts** with registration and login.

## Requirements

- Python 3.9+

## Run it locally (port 5057)

```bash
# 1. Create and activate a virtual environment
python -m venv .venv
# Windows (PowerShell):
.venv\Scripts\Activate.ps1
# macOS / Linux:
# source .venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure secrets
cp .env.example .env            # Windows: copy .env.example .env
# Generate a strong key and paste it as SECRET_KEY in .env:
python -c "import secrets; print(secrets.token_hex(32))"

# 4. Create the database and load sample products
python seed.py

# 5. Start the app
python app.py
```

Then open <http://127.0.0.1:5057>.

The port can be changed with the `PORT` environment variable (defaults to
`5057`). Register an account to post comments; add products to your cart from
the catalogue or a product page.

## How the security requirements are met

| Requirement | Where / how |
|---|---|
| **SQL injection (A03)** | Every query uses parameterised `?` placeholders via the helpers in `db.py`; no string concatenation of user input into SQL. |
| **Password hashing** | Argon2id (`argon2-cffi`) with per-password random salts; plaintext is never stored. Hashes are transparently upgraded on login if parameters change. |
| **Input validation & XSS** | Server-side validation of usernames, password length, comment length and cart quantities. Output is encoded by Jinja2 autoescaping; a strict Content-Security-Policy blocks inline scripts. |
| **CSRF** | Flask-WTF `CSRFProtect` is enabled globally; every state-changing form includes a `csrf_token`. |
| **Access control / IDOR (A01)** | Comment deletion verifies the requester is the author (`user_id` check) before acting. The cart lives in the signed session, so it is inherently per-user. |
| **Secure session cookies** | `HttpOnly`, `SameSite=Lax`, and `Secure` (enabled via `SESSION_COOKIE_SECURE=1` when served over HTTPS). Session is regenerated on login to prevent fixation. |
| **Security headers (A05)** | `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and `Permissions-Policy` set on every response. |
| **No information leakage (A09)** | `debug=False`; custom 403/404/500/CSRF error pages return generic messages while the real exception is only logged server-side. |
| **No hardcoded secrets (A02/A05)** | `SECRET_KEY` and other config are read from environment variables / `.env`; the app refuses to start in production without a `SECRET_KEY`. |

## Project layout

```
app.py            Application, routes, security configuration
db.py             SQLite helpers (parameterised queries)
schema.sql        Database schema
seed.py           Creates tables and loads sample products
templates/        Jinja2 templates (autoescaped)
static/style.css  Styling
requirements.txt  Dependencies
.env.example      Configuration template
```

## Notes for production

- Serve behind HTTPS and set `SESSION_COOKIE_SECURE=1`.
- Run under a WSGI server (e.g. `gunicorn`/`waitress`) rather than the
  development server.
- Set `FLASK_ENV=production` so a missing `SECRET_KEY` is treated as fatal.
