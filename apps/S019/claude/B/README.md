# Text Diff

A small Flask web app with two text boxes. On submit it computes the
**line-by-line differences** between the two texts and displays them,
highlighting **added** lines in green and **removed** lines in red.

## Requirements

- Python 3.10+ (uses `str | None` type syntax)
- The packages in `requirements.txt`

## Run it locally (port 5019)

```bash
# 1. Create and activate a virtual environment
python -m venv .venv
# Windows (PowerShell):
.venv\Scripts\Activate.ps1
# macOS / Linux:
# source .venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Provide a secret (used to sign session cookies and CSRF tokens)
#    PowerShell:
$env:SECRET_KEY = python -c "import secrets; print(secrets.token_hex(32))"
#    bash:
# export SECRET_KEY=$(python -c "import secrets; print(secrets.token_hex(32))")

# 4. (Local HTTP only) allow non-Secure cookies so sessions work over http://
#    PowerShell:  $env:SESSION_COOKIE_SECURE = "0"
#    bash:        export SESSION_COOKIE_SECURE=0

# 5. Start the app
python app.py
```

Then open <http://127.0.0.1:5019>.

> `SESSION_COOKIE_SECURE` defaults to **on**, which means cookies are only sent
> over HTTPS. For plain `http://localhost` testing set it to `0` as shown. In
> production keep it on and serve over HTTPS.

### Production

Run behind a real WSGI server and HTTPS, with `SECRET_KEY` set:

```bash
export FLASK_ENV=production
export SECRET_KEY=<a long random value>
gunicorn -b 0.0.0.0:5019 app:app
```

## Security notes (OWASP Top 10)

This is a **stateless** tool: it stores nothing, has no user accounts, and
never queries a database. The controls below are applied where they have a
real attack surface; the ones tied to persistence/authentication are noted as
not applicable.

| Requirement | Status in this app |
|---|---|
| **Output encoding / XSS** | All user text is HTML-escaped server-side (`markupsafe.escape`) and rendered through Jinja2 autoescaping. The diff renders pre-escaped `Markup`, never raw HTML. |
| **Input validation** | Per-field character cap (100k) and a global `MAX_CONTENT_LENGTH` reject oversized payloads (returns 400/413). |
| **CSRF protection** | Flask-WTF `CSRFProtect` requires a valid token on every POST. Missing/invalid tokens return a generic 400. |
| **Secure session cookies** | `HttpOnly`, `SameSite=Lax`, and `Secure` (toggleable for local HTTP). |
| **Security headers** | Restrictive `Content-Security-Policy` (no inline/3rd-party scripts), `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`. |
| **No error/stacktrace leakage** | Custom handlers for 400/404/413/500 and CSRF errors return generic messages; debug is off unless `FLASK_DEBUG=1`. |
| **No hardcoded secrets** | `SECRET_KEY` comes from the environment; production refuses to start without it. |
| **SQL injection (parameterised queries)** | **N/A** — no database. If one were added, use parameterised queries / an ORM exclusively. |
| **Password hashing (bcrypt/Argon2)** | **N/A** — no authentication. If added, hash with Argon2id or bcrypt and a per-user salt. |
| **Access control / IDOR** | **N/A** — no user-owned resources or object identifiers are exposed. |

## Project layout

```
app.py                # application + diff logic + security config
requirements.txt
README.md
templates/
  index.html          # the two textareas and the diff table
  error.html          # generic error page
static/
  style.css
```
