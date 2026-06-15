# Flask Wiki

A small, security-focused wiki built with Flask and SQLite.

- **Anyone** can read pages, browse the page index, and search by title.
- **Logged-in users** can create and edit pages written in Markdown.
- Pages are stored in SQLite; the database and tables are created automatically
  on first run.

## Requirements

- Python 3.9+

## Run it locally (port 5036)

```bash
# 1. Create and activate a virtual environment
python -m venv .venv
# Windows (PowerShell):
.venv\Scripts\Activate.ps1
# macOS / Linux:
# source .venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure environment (optional for local dev)
cp .env.example .env        # then edit if you like
#   For plain-HTTP localhost, keep SESSION_COOKIE_SECURE=0 (already set in the example).

# 4. Start the app
python app.py
```

Then open <http://127.0.0.1:5036>.

> **Note on cookies:** secure session cookies require HTTPS. For local
> HTTP testing, the example `.env` sets `SESSION_COOKIE_SECURE=0`. In
> production, leave it enabled and serve over HTTPS.

### First steps

1. Click **Register** to create an account.
2. Log in, then click **New page** to create your first wiki page.
3. Anyone (including logged-out visitors) can read pages, use the index, and search.

## Configuration

All configuration comes from environment variables (see `.env.example`):

| Variable                | Purpose                                                        |
| ----------------------- | -------------------------------------------------------------- |
| `SECRET_KEY`            | Flask session/CSRF signing key. **Required in production.**     |
| `FLASK_ENV`             | Set to `production` to require `SECRET_KEY`.                    |
| `SESSION_COOKIE_SECURE` | `1` (default) sends cookies only over HTTPS; `0` for local HTTP.|
| `DATABASE_PATH`         | Optional path to the SQLite file (defaults to `wiki.db`).       |
| `FLASK_DEBUG`           | Set to `1` only for local debugging (off by default).           |

## Security measures (OWASP Top 10)

This project applies defence-in-depth aligned with the OWASP Top 10:

- **SQL injection (A03):** every query uses parameterised statements (`?`
  placeholders) — see `db.py` and the routes in `app.py`. `LIKE` search escapes
  user wildcards.
- **Password storage (A02/A07):** passwords are hashed with **Argon2id**
  (`argon2-cffi`), which is salted per-user; hashes are transparently upgraded
  when parameters change. Plaintext passwords are never stored.
- **XSS (A03):** Jinja2 auto-escaping is on everywhere. Markdown is rendered and
  then **sanitised with an allow-list** (`bleach`) before display, stripping
  `<script>`, event handlers, and `javascript:`/`data:` URLs. A strict
  **Content-Security-Policy** adds a second layer.
- **CSRF (A01):** Flask-WTF `CSRFProtect` protects every state-changing POST
  (create/edit/login/register/logout); tokens are embedded in all forms.
- **Broken access control / IDOR (A01):** only a page's author can edit it
  (`author_id` is checked server-side, returning 403 otherwise). Login is
  required for create/edit. The post-login redirect is restricted to local URLs.
- **Secure session cookies:** `HttpOnly`, `SameSite=Lax`, and `Secure`
  (configurable for local HTTP).
- **Security headers:** CSP, `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy`, and HSTS (when secure).
- **Error handling (A05):** custom 400/403/404/500 pages — stack traces and
  internal details are never sent to clients; debug mode is off by default.
- **Secrets management:** no secrets are hardcoded; `SECRET_KEY` is read from the
  environment and required in production.
- **Input validation:** WTForms validators constrain length and allowed
  characters on all fields; request bodies are capped at 1 MB.

## Project layout

```
app.py          Application factory, routes, headers, error handlers
config.py       Environment-driven configuration
db.py           SQLite connection + schema initialisation
forms.py        WTForms definitions (validation + CSRF)
rendering.py    Safe Markdown → sanitised HTML
schema.sql      Database schema
templates/      Jinja2 templates (auto-escaped)
static/         Stylesheet
```
