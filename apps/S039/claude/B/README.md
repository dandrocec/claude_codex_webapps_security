# Evently — Flask Event Listing

A small Flask application where logged-in users create and manage their own
events (title, date, location, description). A public home page lists all
**upcoming** events sorted by date. Data is stored in SQLite.

## Features

- Public listing of upcoming events, sorted soonest-first.
- User registration and login.
- Organisers create, edit and delete **only their own** events.
- Public per-event detail page.

## Requirements

- Python 3.9+

## Run it locally (port 5039)

```bash
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
#   then edit .env and set a real SECRET_KEY:
#   python -c "import secrets; print(secrets.token_hex(32))"

# 4. Start the app (creates the SQLite DB on first run)
python app.py
```

Open <http://127.0.0.1:5039> in your browser.

The SQLite database is created automatically at `instance/app.db` on first run.

### A note on secure cookies and local HTTP

Session cookies are configured with the `Secure` flag, which means browsers
only send them over **HTTPS**. The shipped `.env.example` sets
`SESSION_COOKIE_SECURE=false` so you can log in over plain `http://localhost`
during local development.

**In production keep `SESSION_COOKIE_SECURE=true` and serve the app over HTTPS**
(e.g. behind nginx/Caddy or a platform load balancer).

## Configuration (environment variables)

| Variable                | Default              | Purpose                                        |
|-------------------------|----------------------|------------------------------------------------|
| `SECRET_KEY`            | random (dev only)    | Signs sessions & CSRF tokens. **Set in prod.** |
| `DATABASE`              | `instance/app.db`    | Path to the SQLite database file.              |
| `SESSION_COOKIE_SECURE` | `true`               | Send session cookie over HTTPS only.           |

## Security measures (OWASP Top 10)

- **SQL injection** — every query uses parameterised statements (`?` binding); no
  string concatenation of user input (`db.py`, `auth.py`, `events.py`).
- **Password storage** — Argon2id hashing with per-password random salt via
  `argon2-cffi` (`auth.py`).
- **XSS** — Jinja2 auto-escaping provides context-aware output encoding; no use
  of `|safe` on user data. Input is also length/format-validated server-side.
- **CSRF** — Flask-WTF `CSRFProtect` validates a token on every state-changing
  (POST) request, including logout and delete.
- **Access control / IDOR** — edit/delete verify `organiser_id == current_user.id`
  and the SQL `WHERE` clause is scoped to the owner; unauthorised access returns 403.
- **Secure session cookies** — `HttpOnly`, `SameSite=Lax`, and `Secure`.
- **Security headers** — CSP, `X-Content-Type-Options`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `Permissions-Policy`, and HSTS (when on HTTPS).
- **Error handling** — debug is off; custom 400/403/404/500 pages avoid leaking
  stack traces or internal details.
- **Secrets** — `SECRET_KEY` is read from the environment, never hardcoded.
- **Input validation** — WTForms validators on all fields; request body size is
  capped via `MAX_CONTENT_LENGTH`.

## Project layout

```
app.py          Application factory, security headers, error handlers
auth.py         User model, Argon2 hashing, register/login/logout
events.py       Public listing, detail, and organiser CRUD
forms.py        WTForms definitions (validation + CSRF)
db.py           SQLite connection helpers (parameterised queries)
schema.sql      Database schema
templates/      Jinja2 templates (auto-escaped)
static/         CSS
```
