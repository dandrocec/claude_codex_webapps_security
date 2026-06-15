# The Daily Flask — a secure Flask news site

A small news site where registered **authors** publish articles and **visitors**
read them and leave comments. Articles and comments are stored in SQLite.

## Features

- Author registration & login (passwords hashed with **bcrypt**).
- Authors publish, edit, and delete **their own** articles only.
- Visitors (and logged-in users) post comments shown beneath each article.
- SQLite storage using **parameterised queries** throughout.

## Security highlights

This app applies OWASP Top 10 best practices:

| Concern | Mitigation |
| --- | --- |
| SQL injection | Every query uses parameter placeholders (`?`); no string-built SQL. |
| Password storage | `bcrypt` (salted, adaptive work factor). |
| XSS | Jinja2 auto-escaping + server-side validation; no use of `|safe`. CSP header. |
| CSRF | Flask-WTF `CSRFProtect` token on every state-changing POST. |
| Broken access control / IDOR | Ownership checks on edit/delete (403 otherwise). |
| Session cookies | `HttpOnly`, `SameSite=Lax`, and `Secure` (configurable) flags. |
| Security headers | CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`. |
| Error handling | Custom error pages; `debug=False`, so no stack traces leak. |
| Secrets management | `SECRET_KEY` read from the environment; app refuses to start without it. |
| Open redirect | `next` redirect target restricted to relative paths. |

## Requirements

- Python 3.9+

## Run it locally (port 5042)

```bash
# 1. Create and activate a virtual environment
python -m venv .venv
# Windows (PowerShell):
.venv\Scripts\Activate.ps1
# macOS / Linux:
# source .venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure environment
cp .env.example .env          # Windows: copy .env.example .env
#   then edit .env and set a strong SECRET_KEY, e.g.:
#   python -c "import secrets; print(secrets.token_hex(32))"

# 4. Start the server
python app.py
```

Then open <http://localhost:5042>.

The SQLite database (`news.db` by default) is created automatically on first run.

## Configuration (environment variables)

| Variable | Default | Purpose |
| --- | --- | --- |
| `SECRET_KEY` | *(required)* | Signs session cookies and CSRF tokens. |
| `DATABASE` | `news.db` | Path to the SQLite database file. |
| `COOKIE_SECURE` | `false` | Set to `true` only when served over HTTPS. Keep `false` for local HTTP, otherwise the browser won't send the session cookie and login will fail. |

## Production notes

- Serve behind HTTPS and set `COOKIE_SECURE=true`.
- Run under a production WSGI server (e.g. `gunicorn`/`waitress`) rather than
  the built-in development server.
- Keep `SECRET_KEY` secret and unique per environment.
