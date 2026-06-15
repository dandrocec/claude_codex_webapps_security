# Flask Notes

A small, security-focused notes app. Register, log in, and manage your own
private notes (title + body). Notes are stored in SQLite and are only ever
visible to the user who created them.

## Requirements

* Python 3.9+

## Run locally (port 5028)

### 1. Create a virtual environment and install dependencies

**macOS / Linux**
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

**Windows (PowerShell)**
```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### 2. Set the required secret

A `SECRET_KEY` is **required** — the app refuses to start without one (it is
used to sign session cookies and CSRF tokens). Generate a strong value:

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

**macOS / Linux**
```bash
export SECRET_KEY="<paste the generated value>"
# When testing over plain HTTP on localhost, allow the session cookie to be
# sent without HTTPS (it is Secure by default):
export SESSION_COOKIE_SECURE=false
```

**Windows (PowerShell)**
```powershell
$env:SECRET_KEY = "<paste the generated value>"
$env:SESSION_COOKIE_SECURE = "false"
```

### 3. Start the app

```bash
python app.py
```

Then open <http://127.0.0.1:5028>. The SQLite database (`notes.db`) is created
automatically on first run.

## Configuration (environment variables)

| Variable                | Default       | Purpose                                                              |
| ----------------------- | ------------- | -------------------------------------------------------------------- |
| `SECRET_KEY`            | *(required)*  | Signs session cookies and CSRF tokens. App won't start without it.   |
| `SESSION_COOKIE_SECURE` | `true`        | Restrict the session cookie to HTTPS. Set `false` for local HTTP.    |
| `PORT`                  | `5028`        | Port to listen on.                                                   |
| `HOST`                  | `127.0.0.1`   | Interface to bind.                                                   |
| `DATABASE_PATH`         | `./notes.db`  | SQLite file location.                                                |
| `FLASK_DEBUG`           | `false`       | Never enable in production — it would expose tracebacks.             |

## Production notes

Run behind a real WSGI server and HTTPS terminator, e.g.:

```bash
pip install gunicorn
SECRET_KEY=... gunicorn -b 0.0.0.0:5028 "app:app"
```

Keep `SESSION_COOKIE_SECURE=true` (the default) so cookies are sent only over
HTTPS, and serve the app over TLS.

## How the security requirements are met

| Requirement                         | Implementation                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| SQL injection                       | Every query uses parameterised statements (`?` placeholders) — no string interpolation.                |
| Password storage                    | `bcrypt` with a per-password salt (`bcrypt.gensalt()`).                                                 |
| Input validation                    | WTForms validators on length, allowed characters, and required fields.                                 |
| Output encoding (XSS)               | Jinja2 autoescaping encodes all rendered values context-aware; a strict CSP blocks inline scripts.     |
| CSRF                                | Flask-WTF issues/validates a CSRF token on every POST (forms and logout/delete buttons).               |
| Access control / IDOR               | Every note query is scoped to `owner_id = current_user.id`; mismatches return 404.                     |
| Secure session cookies              | `HttpOnly`, `SameSite=Lax`, and `Secure` (configurable) on the session cookie.                         |
| Security headers                    | CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS.       |
| No error/stack-trace leakage        | Debug off by default; custom 400/403/404/500 handlers return generic messages.                         |
| No hardcoded secrets                | `SECRET_KEY` is read from the environment and is mandatory.                                            |
