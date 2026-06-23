# Quill — a role-based Flask blog

A small but complete blog with an editorial workflow and three roles:

| Role     | Can do                                                                 |
|----------|-----------------------------------------------------------------------|
| **reader** | Browse approved posts; personal dashboard                           |
| **author** | Write drafts, submit them for review, edit/resubmit, delete         |
| **editor** | See the submission queue, approve or reject posts (with a note)     |

Approved posts appear publicly on the home page. Each role gets its own dashboard.

Data is stored in **SQLite**. The app listens on **port 5060**.

---

## Quick start (local)

Requires Python 3.9+.

```bash
# 1. Create and activate a virtual environment
python -m venv .venv
# Windows (PowerShell):
.venv\Scripts\Activate.ps1
# macOS / Linux:
# source .venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Create a local config from the template
#    (sets a dev SECRET_KEY and allows cookies over plain HTTP)
cp .env.example .env          # Windows: copy .env.example .env

# 4. Create the database and load demo data
python seed.py

# 5. Run on port 5060
python app.py                 # Flask dev server
# or, production-style WSGI server:
# python serve.py
```

Open <http://127.0.0.1:5060>.

> **Local cookies note:** secure cookies are only sent over HTTPS. The provided
> `.env.example` sets `SESSION_COOKIE_SECURE=False` so login works over plain
> `http://` locally. In production keep it `True` and serve over HTTPS.

### Demo logins (created by `seed.py`)

| Username | Password           | Role   |
|----------|--------------------|--------|
| reader   | `reader-password`  | reader |
| aisha    | `author-password`  | author |
| ben      | `author-password`  | author |
| edith    | `editor-password`  | editor |

You can also register new accounts at `/register`.

### Starting from an empty database instead of demo data

```bash
flask --app app init-db    # creates tables only
python app.py
```

---

## Configuration (environment variables)

No secrets are hardcoded; everything sensitive comes from the environment
(a local `.env` is loaded automatically). See `.env.example`.

| Variable                | Purpose                                            | Default       |
|-------------------------|----------------------------------------------------|---------------|
| `SECRET_KEY`            | Session signing / CSRF key (**set in production**) | random per run |
| `DATABASE_PATH`         | SQLite file location                               | `./blog.db`   |
| `SESSION_COOKIE_SECURE` | Send cookies only over HTTPS                       | `True`        |

Generate a strong key:

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

---

## Security measures (OWASP Top 10)

This app was built with the OWASP Top 10 in mind:

- **A01 Broken Access Control / IDOR** — `role_required(...)` restricts routes by
  role; every author action re-checks `author_id == current_user.id` (and SQL
  `WHERE` clauses are scoped to the owner), so users can only act on their own
  posts. Editorial actions are editor-only.
- **A02 Cryptographic Failures** — passwords hashed with **bcrypt** (per-user
  salt). Plaintext passwords are never stored or logged.
- **A03 Injection** — **all** database access uses parameterised queries
  (`?` placeholders in `db.py`); no string concatenation of user input into SQL.
- **XSS** — Jinja2 autoescaping provides context-aware output encoding; user
  content is never marked `|safe`. A strict **Content-Security-Policy** backs
  this up.
- **CSRF** — Flask-WTF `CSRFProtect` enforces a token on every state-changing
  POST (forms and logout included).
- **A05 Security Misconfiguration** — security headers (`CSP`,
  `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`,
  `Permissions-Policy`, `HSTS` over HTTPS); debug is **off** so stack traces are
  never sent to clients — errors render a generic page and are logged server-side.
- **Secure sessions** — cookies are `HttpOnly`, `SameSite=Lax`, and `Secure`
  (configurable), with an 8-hour lifetime.
- **A07 Auth Failures** — Flask-Login session management; login uses a constant
  bcrypt verification path and a generic error message to resist user
  enumeration and timing attacks. Input is validated and length-bounded
  server-side via WTForms; requests are capped at 1 MB.
- **A09 Secrets** — read from environment variables, not source.

---

## Project layout

```
app.py          Application factory, routes, access control, security headers
config.py       Env-driven configuration (cookies, secret key, CSRF)
db.py           SQLite helpers — parameterised queries only
forms.py        WTForms definitions (validation + CSRF)
schema.sql      Database schema
seed.py         Create schema + demo users/posts
serve.py        Production-style waitress server (port 5060)
templates/      Jinja2 templates (autoescaped)
static/style.css
requirements.txt
.env.example
```
