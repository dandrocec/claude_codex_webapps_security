# Voting Platform

A small Flask + SQLite voting application.

- **Admins** create elections (title, description, candidates, open/close times).
- **Registered users** cast **exactly one** vote per election while it is open.
- **Results** are revealed only after an election closes.

## Requirements

- Python 3.9+

## Run locally (port 5081)

```bash
cd voting_platform

# 1. Create and activate a virtual environment
python -m venv .venv
# Windows (PowerShell):
.venv\Scripts\Activate.ps1
# macOS/Linux:
# source .venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure environment
cp .env.example .env          # Windows: copy .env.example .env
#   then edit .env and set SECRET_KEY (and an ADMIN_USERNAME/ADMIN_PASSWORD)
#   generate a key:  python -c "import secrets; print(secrets.token_hex(32))"

# 4. Start the app
python app.py
```

Open <http://127.0.0.1:5081>.

The SQLite database (`voting.db`) and its tables are created automatically on
first run. If `ADMIN_USERNAME` / `ADMIN_PASSWORD` are set in `.env`, that admin
account is created on startup; otherwise register a normal user and promote it
manually (set `is_admin = 1` in the `users` table).

> **Local HTTP note:** browsers will not send a `Secure` cookie over plain
> `http://`. For local testing keep `COOKIE_SECURE=0` in `.env`. In any real
> deployment serve over HTTPS and set `COOKIE_SECURE=1` and
> `FLASK_ENV=production`.

## Usage

1. Log in as the admin and click **New election**. Enter a title, optional
   description, open/close times (UTC), and one candidate per line.
2. Registered users open an election and submit a vote while it is **open**.
3. Once the close time passes, the election shows **results** to any logged-in
   user.

## Security overview

| OWASP risk | Mitigation |
|---|---|
| Injection (SQLi) | All queries use parameterised (`?`) placeholders. |
| Broken authentication | Passwords hashed with **Argon2id** (salted); session reset on login to prevent fixation. |
| Sensitive data exposure | `SECRET_KEY` and admin creds read from environment, never hardcoded. |
| XSS | Jinja2 auto-escaping + strict input validation; CSP `script-src 'self'`. |
| CSRF | Flask-WTF `CSRFProtect` on every state-changing POST (login, register, vote, create, logout). |
| Broken access control / IDOR | Voter identity is taken from the session, never the request body; candidate ownership is verified; admin-only routes guarded; results gated on close time. |
| Security misconfiguration | `HttpOnly` + `SameSite=Lax` (+ `Secure` in prod) cookies; security headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy). |
| Insufficient logging / error handling | Generic error pages; stack traces are logged server-side, never returned to clients. |

Duplicate voting is prevented both in application logic and by a
`UNIQUE(election_id, user_id)` database constraint (race-safe).

## Project layout

```
voting_platform/
├── app.py            # routes, forms, security config
├── db.py             # SQLite connection helpers (parameterised access)
├── schema.sql        # table definitions
├── requirements.txt
├── .env.example
├── static/style.css
└── templates/
```
