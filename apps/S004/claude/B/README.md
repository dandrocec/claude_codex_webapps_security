# Temperature Converter

A small Flask web app that converts a temperature between Celsius and
Fahrenheit. Enter a value, pick a direction, and submit to see the result.

## Run locally (port 5004)

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

# 3. Set a secret key (required). Generate a random one:
#   Windows (PowerShell):
$env:SECRET_KEY = python -c "import os; print(os.urandom(32).hex())"
#   macOS / Linux:
# export SECRET_KEY=$(python -c "import os; print(os.urandom(32).hex())")

# 4. (Local HTTP only) allow non-Secure cookies, since there is no HTTPS:
#   Windows (PowerShell):
$env:COOKIE_SECURE = "0"
#   macOS / Linux:
# export COOKIE_SECURE=0

# 5. Run on port 5004
python app.py
```

Then open <http://127.0.0.1:5004>.

### Environment variables

| Variable        | Required           | Purpose                                                                 |
| --------------- | ------------------ | ----------------------------------------------------------------------- |
| `SECRET_KEY`    | Yes (in non-debug) | Signs the session/CSRF tokens. Never commit this. Use a random value.   |
| `COOKIE_SECURE` | No (default `1`)   | Set to `0` for local plain-HTTP dev so the session cookie is sent.      |
| `PORT`          | No (default `5004`)| Port to bind.                                                           |

> In production, serve behind HTTPS, leave `COOKIE_SECURE=1`, and run with a
> WSGI server (e.g. `gunicorn 'app:app'`) instead of the development server.

## Security controls

This app applies the OWASP Top 10 controls that are relevant to its surface:

- **CSRF protection** — Flask-WTF issues and validates a CSRF token on every
  POST. Requests without a valid token are rejected.
- **Input validation** — the submitted value must be a number within range and
  not below absolute zero for the chosen scale; the direction must be one of
  two allowed choices (server-side allow-list, not free text).
- **Output encoding (XSS)** — Jinja2 autoescaping is on; all rendered values
  are context-encoded. No user input is ever rendered as raw HTML.
- **Security headers** — a strict `Content-Security-Policy`,
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `Permissions-Policy`, and HSTS (when on HTTPS).
- **Secure session cookies** — `HttpOnly`, `SameSite=Lax`, and `Secure`
  (toggleable for local dev).
- **No error leakage** — unhandled exceptions are logged server-side and the
  client sees a generic 500 page, never a stack trace.
- **No hardcoded secrets** — `SECRET_KEY` is read from the environment.

### Requirements that do not apply here

The brief lists three controls that need a surface this app does not have:

- **SQL injection / parameterised queries** — there is no database and no SQL.
- **Password hashing (bcrypt/Argon2)** — there are no user accounts or
  passwords.
- **Access control / IDOR** — there are no per-user resources or object IDs;
  every request is stateless and identical for all visitors.

If the app later grows authentication or persistence, these controls should be
added at that point (use parameterised queries / an ORM, hash passwords with
Argon2 or bcrypt, and enforce ownership checks on every object access).
