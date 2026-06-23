# Flask Ledger

A small ledger web app. Users register, log in, and transfer funds to other
users. Every transfer is recorded as an **immutable** transaction, and balances
update **atomically** so a balance can never go negative. Each user sees only
their own transaction history. Data is stored in SQLite.

## Requirements

- Python 3.10+

## Run locally on port 5093

```bash
# 1. Create and activate a virtual environment
python -m venv .venv
# Windows (PowerShell):
.venv\Scripts\Activate.ps1
# macOS/Linux:
# source .venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Set a secret key (required for stable sessions)
#    PowerShell:
$env:SECRET_KEY = python -c "import secrets; print(secrets.token_hex(32))"
$env:SECURE_COOKIES = "false"   # needed for local HTTP; see note below
#    macOS/Linux:
# export SECRET_KEY=$(python -c "import secrets; print(secrets.token_hex(32))")
# export SECURE_COOKIES=false

# 4. Run
python app.py
```

The app starts on <http://127.0.0.1:5093>. The SQLite database (`ledger.db`)
and its tables are created automatically on first run.

> **Local HTTP note:** session cookies are flagged `Secure` by default, which
> means browsers won't send them over plain HTTP. For local testing set
> `SECURE_COOKIES=false`. In production, serve over HTTPS and leave it unset
> (or `true`).

## Try it

1. Register two accounts (each starts with a **$100.00** demo balance).
2. Log in as one, send funds to the other from the dashboard.
3. View **History** to see the immutable record. Attempting to overdraw is
   rejected; balances never go negative.

## Configuration (environment variables)

| Variable         | Default       | Purpose                                              |
|------------------|---------------|------------------------------------------------------|
| `SECRET_KEY`     | random (dev)  | Flask session signing key. **Set this in prod.**     |
| `SECURE_COOKIES` | `true`        | Set `false` only for local HTTP testing.             |
| `LEDGER_DB`      | `./ledger.db` | Path to the SQLite database file.                    |

See `.env.example`.

## Security measures

Maps to the OWASP Top 10:

- **SQL injection** — every query uses parameterised bindings (`?`), never
  string concatenation (`db.py`, `app.py`).
- **Password storage** — Argon2id (`argon2-cffi`) with a unique per-password
  salt; hashes are transparently upgraded on login when parameters change.
- **Broken access control / IDOR** — history is scoped to the session user's id;
  there are no resource ids in URLs to tamper with. Transfers debit only the
  logged-in user's own account.
- **CSRF** — Flask-WTF `CSRFProtect` enforces a token on every state-changing
  POST (transfer, logout, login, register).
- **XSS** — Jinja2 auto-escaping for context-aware output encoding, plus a
  strict Content-Security-Policy (no inline scripts).
- **Input validation** — WTForms validators on the server: username pattern,
  password length, positive amount with no sub-cent precision and an upper
  ceiling.
- **Secure session cookies** — `HttpOnly`, `SameSite=Lax`, and `Secure`
  (configurable for local HTTP). Session is rotated on login/logout.
- **Security headers** — CSP, `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy`, and HSTS (when cookies are Secure).
- **No information leakage** — `debug=False`; generic error pages; details are
  logged server-side only. Login uses a constant-time-ish path and uniform
  messaging to avoid user enumeration.
- **Secrets** — read from environment variables; nothing is hardcoded.
- **Money correctness** — stored as integer cents; transfers run inside a
  single `BEGIN IMMEDIATE` transaction, the debit is conditional on sufficient
  funds, and a `CHECK (balance_cents >= 0)` constraint is the final backstop.

## Project layout

```
app.py            # routes, forms, auth, security headers
db.py             # SQLite connection handling + init
schema.sql        # tables and constraints
templates/        # Jinja2 templates (auto-escaped)
static/style.css  # styling (CSP-friendly, no inline)
requirements.txt
.env.example
```
