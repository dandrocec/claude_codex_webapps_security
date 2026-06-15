# QR Code Generator (Flask)

A small Flask web app that turns **text or a URL** entered in a form into a
**QR-code PNG**, shows it on the result page, and lets you **download it**.
Optionally, create an account to keep a private, access-controlled history of
your generated codes.

## Features

- Enter any text or URL → generated QR code shown on the result page.
- Download the QR code as a PNG.
- Optional accounts with a **per-user** history (you can only see, download,
  or delete your *own* codes).

## Requirements

- Python 3.10+

## Run it locally (port 5008)

```bash
# 1. Clone / unzip, then from the project folder:
python -m venv .venv

# Activate the virtualenv
#   Windows (PowerShell):
.venv\Scripts\Activate.ps1
#   macOS / Linux:
source .venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure environment
cp .env.example .env          # Windows: copy .env.example .env
#   Generate and paste a SECRET_KEY into .env:
python -c "import secrets; print(secrets.token_hex(32))"

# 4. Run
python app.py
```

Then open <http://localhost:5008>.

> The app reads `.env` automatically only if you load it. The simplest path is
> to export the variables, **or** run via the provided loader:
>
> ```bash
> # Loads .env then starts the server on PORT (default 5008)
> python -m dotenv run -- python app.py     # if python-dotenv[cli] is present
> ```
>
> Otherwise set them in your shell, e.g. (PowerShell):
> ```powershell
> $env:SECRET_KEY = (python -c "import secrets; print(secrets.token_hex(32))")
> $env:FLASK_ENV = "development"
> python app.py
> ```

In `development` mode a random `SECRET_KEY` is generated if none is set, so the
app runs out of the box for a quick try — but **always set a real `SECRET_KEY`
for anything persistent or production.**

The SQLite database (`qrapp.db`) and tables are created automatically on first
run.

## Configuration (environment variables)

| Variable               | Default              | Purpose                                            |
|------------------------|----------------------|----------------------------------------------------|
| `SECRET_KEY`           | *(required in prod)* | Signs session cookies and CSRF tokens.             |
| `FLASK_ENV`            | `production`         | `development` enables dev conveniences.            |
| `SESSION_COOKIE_SECURE`| `0` (dev) / `1` prod | Adds `Secure` flag — enable only over HTTPS.       |
| `DATABASE_URL`         | `sqlite:///qrapp.db` | SQLAlchemy database URL.                            |
| `PORT`                 | `5008`               | Port the dev server listens on.                    |

## Security

This app applies OWASP Top 10 best practices:

- **A01 Broken Access Control / IDOR** — every QR-code query is filtered by both
  the resource id **and** the current user's id, so requesting another user's id
  returns 404 rather than their data. History/download/delete routes require login.
- **A02 Cryptographic failures** — passwords are hashed with **Argon2id**
  (strong, salted, memory-hard); plaintext is never stored. Cookies can be
  marked `Secure` over HTTPS.
- **A03 Injection** — all DB access uses SQLAlchemy's ORM with **parameterised /
  bound queries**; user input is never concatenated into SQL. QR content is
  treated as opaque data and never executed.
- **A03 XSS** — Jinja2 autoescaping provides context-aware output encoding;
  user input is validated and length-limited; a strict **Content-Security-Policy**
  blocks inline/foreign scripts.
- **A05 Security misconfiguration** — debug is **off** (no tracebacks to clients),
  custom error pages, request-size cap, and security headers
  (`Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `Permissions-Policy`, and `HSTS` when on HTTPS).
- **A07 Identification & auth failures** — generic login errors (no user
  enumeration), constant-time password verification, min-12-char passwords.
- **CSRF** — Flask-WTF issues and validates a CSRF token on **every** state-changing
  (POST) request, including logout and delete.
- **Session cookies** — `HttpOnly`, `SameSite=Lax`, and `Secure` (configurable).
- **Secrets** — read from environment variables; nothing sensitive is hard-coded.
- **Open redirect** — post-login `next` redirects are restricted to same-site
  relative paths.

## Project layout

```
app.py            # app factory, routes, security headers, error handlers
config.py         # env-driven configuration
models.py         # SQLAlchemy models (User, QRCode) + Argon2 hashing
forms.py          # WTForms forms with validation + CSRF
templates/        # Jinja2 templates (autoescaped)
static/style.css  # styling (no inline styles/scripts, CSP-friendly)
requirements.txt  # dependencies
.env.example      # configuration template
```
