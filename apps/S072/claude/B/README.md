# MemberHub — Flask membership site

A small membership site with **free** and **premium** tiers, an **admin** panel
for changing a user's tier, tier-aware navigation, and SQLite storage. It is
built with the OWASP Top 10 in mind.

## Features

- Register / login / logout with server-side validation.
- Two membership tiers: `free` and `premium`.
- **Premium content** (`/premium`) is enforced **server-side** — a free user
  who navigates directly to the URL gets a `403`, not the content.
- **Admin panel** (`/admin`) lets an admin change any member's tier.
- **Navigation changes per tier**: premium/admin users see a *Premium* link,
  free users see an *Upgrade* hint, admins additionally see an *Admin* link.

## Requirements

- Python 3.10+ (tested on 3.14)

## Run locally on port 5072

```bash
# 1. Create and activate a virtual environment
python -m venv .venv
# Windows (PowerShell):
.\.venv\Scripts\Activate.ps1
# macOS/Linux:
# source .venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Set a secret key (recommended) and an initial admin account
#    PowerShell:
$env:FLASK_SECRET_KEY = python -c "import secrets;print(secrets.token_hex(32))"
$env:BOOTSTRAP_ADMIN_EMAIL = "admin@example.com"
$env:BOOTSTRAP_ADMIN_PASSWORD = "change-this-admin-pass-12+"
#    bash:
# export FLASK_SECRET_KEY=$(python -c "import secrets;print(secrets.token_hex(32))")
# export BOOTSTRAP_ADMIN_EMAIL=admin@example.com
# export BOOTSTRAP_ADMIN_PASSWORD='change-this-admin-pass-12+'

# 4. Run — serves on http://127.0.0.1:5072
python app.py
```

Then open <http://127.0.0.1:5072>.

The SQLite database (`membership.db`) and tables are created automatically on
first run. If you set the two `BOOTSTRAP_ADMIN_*` variables, an admin account is
created on first launch; otherwise register a normal account and promote it by
flipping `is_admin` once, or set the env vars and restart.

## Environment variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `FLASK_SECRET_KEY` | Session/CSRF signing key. **Set this in production.** | random ephemeral key (sessions reset on restart) |
| `DATABASE_PATH` | SQLite file location | `membership.db` next to the app |
| `SESSION_COOKIE_SECURE` | Send the session cookie only over HTTPS | `false` (set `true` in production behind TLS) |
| `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` | Create an initial admin on first run | unset |
| `PORT` | Listen port | `5072` |

> **Local HTTP note:** `SESSION_COOKIE_SECURE` defaults to `false` so login
> works over plain `http://127.0.0.1:5072`. In production terminate TLS and set
> `SESSION_COOKIE_SECURE=true`.

## Security controls (OWASP Top 10)

| Requirement | How it is implemented |
| --- | --- |
| **SQL injection (A03)** | All DB access in `db.py` uses parameterised `?` queries; no string-built SQL. |
| **Password storage (A02/A07)** | `bcrypt` with a per-password random salt and a work factor of 12 (`security.py`). |
| **Input validation (A03)** | WTForms validators (email format, length, allow-list regex for names) in `forms.py`. |
| **Output encoding / XSS (A03)** | Jinja2 autoescaping (on by default) + a restrictive `Content-Security-Policy` with no inline scripts. |
| **CSRF (A01)** | Flask-WTF `CSRFProtect` on all POST requests; every form carries a CSRF token. |
| **Access control / IDOR (A01)** | `login_required`, `premium_required`, `admin_required` decorators; the profile page edits only the session user — never a client-supplied id. Admin tier changes are admin-only and validated. |
| **Secure session cookies** | `HttpOnly`, `SameSite=Lax`, and configurable `Secure` (`config.py`). |
| **Security headers (A05)** | CSP, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, and HSTS over HTTPS (`app.py`). |
| **No information leakage (A05/A09)** | `debug=False`; custom 400/403/404/500 error pages; tracebacks are logged server-side, never shown to clients. Login/registration return generic messages to avoid user enumeration. |
| **No hardcoded secrets** | Secret key and admin bootstrap creds read from environment variables. |
| **Open redirect** | Post-login `next` redirects are restricted to same-site relative paths. |

## Project layout

```
app.py          # app factory, security headers, error handlers, entry point
config.py       # env-driven configuration
db.py           # SQLite schema + parameterised queries
security.py     # bcrypt hashing + access-control decorators
forms.py        # WTForms (validation + CSRF)
auth.py         # register / login / logout routes
views.py        # home / premium / profile / admin routes
templates/      # Jinja2 templates (autoescaped)
static/style.css
requirements.txt
```
