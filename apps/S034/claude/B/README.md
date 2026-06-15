# Reading List

A small Flask app where users register, log in, and track books they want to
read, are reading, or have finished — with an optional 1–5 star rating. Each
user only ever sees and edits their own list. Data is stored in SQLite.

## Features

- User registration and login (sessions via Flask-Login)
- Per-user book list: title, author, status (`to-read` / `reading` / `finished`), rating
- Add, edit, delete books; books are sorted with "reading" first
- Built with security as a first-class concern (see below)

## Requirements

- Python 3.9+

## Run locally (port 5034)

```bash
# 1. Create and activate a virtual environment
python -m venv .venv
# Windows (PowerShell):
.venv\Scripts\Activate.ps1
# macOS/Linux:
# source .venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. (Optional) configure environment
cp .env.example .env          # Windows: copy .env.example .env
#   No .env is required for local development:
#   - SECRET_KEY defaults to a random per-run value (set it for stable sessions).
#   - In development, Secure cookies are auto-relaxed so login works over http;
#     in production (FLASK_ENV=production) they default to HTTPS-only.

# 4. Start the app
python app.py
```

Then open <http://127.0.0.1:5034>. The SQLite database is created automatically
under `instance/reading_list.sqlite3` on first run.

### Running in production

Set real values and serve behind HTTPS with a WSGI server:

```bash
export SECRET_KEY="$(python -c 'import secrets; print(secrets.token_hex(32))')"
export FLASK_ENV=production
# leave SESSION_COOKIE_SECURE unset so cookies are HTTPS-only
pip install gunicorn
gunicorn --bind 0.0.0.0:5034 "app:app"
```

## Security notes (OWASP Top 10)

This app implements the security requirements as follows:

- **SQL injection** — every query uses parameterised statements (`?`
  placeholders) via `sqlite3`; no user input is concatenated into SQL.
- **Password storage** — passwords are hashed with **Argon2id**
  (`argon2-cffi`), a memory-hard, per-password-salted algorithm. Hashes are
  transparently upgraded (`check_needs_rehash`) when parameters change.
- **Input validation** — all input is validated server-side with WTForms
  (length bounds, username character allow-list, status enum, rating range).
  The DB also enforces `CHECK` constraints on status and rating.
- **XSS** — Jinja2 autoescaping is on for all templates (context-aware output
  encoding); a strict **Content-Security-Policy** blocks inline/external
  scripts as defence-in-depth.
- **CSRF** — Flask-WTF `CSRFProtect` requires a valid token on every
  state-changing (POST) request, including logout and delete.
- **Access control / IDOR** — every book query is scoped to
  `user_id = current_user.id`; requesting another user's book id returns 404.
  Protected routes use `@login_required`.
- **Secure session cookies** — `HttpOnly`, `SameSite=Lax`, and `Secure`
  (auto-on in production; relaxed in development for local HTTP testing).
- **Security headers** — CSP, `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy`, and HSTS (when secure cookies are on).
- **Error handling** — `debug=False`; custom 400/403/404/500 pages return
  generic messages so stack traces and internals are never leaked. Request body
  size is capped (`MAX_CONTENT_LENGTH`).
- **Secrets** — `SECRET_KEY` and other config are read from environment
  variables (`.env` is git-ignored); nothing sensitive is hardcoded.

## Project layout

```
app.py        Application factory, security headers, error handlers
auth.py       Registration / login / logout (Argon2, Flask-Login)
books.py      Per-user book CRUD (ownership-scoped queries)
forms.py      WTForms definitions + validation
db.py         SQLite connection helpers + schema init
schema.sql    Database schema
templates/    Jinja2 templates (autoescaped)
static/       CSS
```
