# Scheduler

A small Flask scheduling app backed by SQLite.

- **Providers** publish available time slots.
- **Clients** browse open slots, book a free one, and get a confirmation.
- A slot can **never be booked twice** (claimed atomically in the database).
- Each role sees only **its own** appointments.

## Requirements

- Python 3.10+ (developed on 3.14)

## Run it locally (port 5068)

```bash
# 1. Create and activate a virtual environment
python -m venv .venv
# Windows (PowerShell):
.venv\Scripts\Activate.ps1
# macOS / Linux:
# source .venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Provide a secret key (required for stable sessions)
#    PowerShell:
$env:FLASK_SECRET_KEY = python -c "import secrets; print(secrets.token_hex(32))"
#    bash:
# export FLASK_SECRET_KEY=$(python -c "import secrets; print(secrets.token_hex(32))")

# 4. (Local HTTP only) allow cookies over http, since the Secure flag is on by default
#    PowerShell:
$env:SECURE_COOKIES = "0"
#    bash:
# export SECURE_COOKIES=0

# 5. Start the app
python app.py
```

Open <http://127.0.0.1:5068>.

The SQLite database is created automatically on first run at
`instance/scheduler.sqlite3`.

### Try it

1. Register a **provider** account and publish a couple of slots.
2. Log out, register a **client** account.
3. As the client, browse open slots and book one — you'll get a confirmation
   and see it under **My appointments**.
4. Log back in as the provider to see who booked which slot.

## Configuration (environment variables)

| Variable            | Default                          | Purpose                                              |
| ------------------- | -------------------------------- | ---------------------------------------------------- |
| `FLASK_SECRET_KEY`  | random (ephemeral)               | Signs the session cookie. Set this in production.    |
| `SECURE_COOKIES`    | `1` (Secure flag on)             | Set to `0` to allow cookies over local HTTP.         |
| `DATABASE_PATH`     | `instance/scheduler.sqlite3`     | SQLite database file location.                       |
| `PORT`              | `5068`                           | Port to listen on.                                   |

No secrets are hard-coded; all are read from the environment.

## Security measures (OWASP Top 10)

| Concern                          | How it's handled                                                                 |
| -------------------------------- | -------------------------------------------------------------------------------- |
| **Injection (A03)**              | Every SQL query uses parameterised `?` placeholders — no string interpolation.   |
| **Cross-site scripting (XSS)**   | Jinja2 auto-escaping for all output; strict Content-Security-Policy (no inline). |
| **Password storage (A02/A07)**   | Argon2id hashing with per-password salt (`argon2-cffi`); auto re-hash on login.  |
| **CSRF**                         | Flask-WTF `CSRFProtect` validates a token on every state-changing POST.           |
| **Access control / IDOR (A01)**  | `login_required` + role checks; every query is scoped to the owner's `user id`.  |
| **Broken auth (A07)**            | Session cleared on login (fixation defence); uniform timing to deter enumeration.|
| **Double booking**               | `UPDATE ... WHERE status='open'` claims a slot atomically; second attempt fails. |
| **Secure session cookies (A05)** | `HttpOnly`, `SameSite=Lax`, and `Secure` (configurable for local HTTP).          |
| **Security headers (A05)**       | CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, HSTS.       |
| **Error handling (A05)**         | Custom 400/403/404/500 pages; stack traces never reach the client.               |
| **Secrets management**           | Secret key and config read from environment variables, never committed.          |
| **Open redirect**                | Post-login `next` redirects restricted to same-site relative paths.              |
| **Request size**                 | `MAX_CONTENT_LENGTH` caps request bodies.                                        |

## Project layout

```
app.py              Application factory, routes, auth, security headers
db.py               SQLite access layer + schema
forms.py            WTForms (validation + CSRF)
templates/          Jinja2 templates (auto-escaped)
static/style.css    Styling (external, to satisfy the CSP)
requirements.txt    Dependencies
```
