# Flask Pastebin

A minimal, security-hardened pastebin. Submit a block of text; the app stores
it in SQLite and redirects you to a unique, unguessable URL that renders the
stored text. Optional accounts let you track and delete your own pastes.

## Requirements

- Python 3.9+

## Run it locally (port 5023)

```bash
# 1. Create and activate a virtual environment
python -m venv .venv
# Windows (PowerShell):
.venv\Scripts\Activate.ps1
# macOS / Linux:
# source .venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Provide a secret key (never hardcoded). Pick ONE:

# PowerShell (Windows):
$env:SECRET_KEY = python -c "import secrets; print(secrets.token_hex(32))"
$env:SECURE_COOKIES = "false"   # allows the session cookie over local http
$env:PORT = "5023"

# bash/zsh (macOS/Linux):
# export SECRET_KEY=$(python -c "import secrets; print(secrets.token_hex(32))")
# export SECURE_COOKIES=false
# export PORT=5023

# 4. Start the app
python app.py
```

Then open <http://127.0.0.1:5023/>.

The SQLite database (`pastebin.db`) is created automatically on first run.

> **Note on `SECURE_COOKIES`:** session cookies default to `Secure` (HTTPS-only).
> For local testing over plain `http://` you must set `SECURE_COOKIES=false`,
> otherwise the browser will not send the cookie and login won't persist.
> Leave it `true` (the default) in any real, HTTPS deployment.

## Usage

- **/** — create a paste (works anonymously or logged in).
- **/p/&lt;id&gt;** — view a paste.
- **/register**, **/login**, **/logout** — account management.
- **/mine** — list and delete your own pastes (login required).

## Security measures (OWASP Top 10)

| Area | Implementation |
|------|----------------|
| **SQL injection (A03)** | All queries use parameterised statements (`?` placeholders); no string concatenation. |
| **Password storage (A02/A07)** | Argon2id via `argon2-cffi`, automatically salted, with transparent rehash-on-login. |
| **XSS (A03)** | Jinja2 autoescaping for all output; stored paste text is rendered escaped inside `<pre>`. Strict Content-Security-Policy blocks inline/3rd-party scripts. |
| **CSRF (A01)** | Flask-WTF `CSRFProtect` enforces a token on every POST (create, delete, login, logout, register). |
| **Access control / IDOR (A01)** | Delete checks `owner_id` against the session user; non-owners get `403`. Paste IDs are 12-byte URL-safe random tokens. |
| **Session cookies** | `HttpOnly`, `SameSite=Lax`, and `Secure` (configurable). Session is cleared/rotated on login to prevent fixation. |
| **Security headers** | CSP, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, and HSTS when on HTTPS. |
| **Input validation** | Server-side length/format checks on usernames, passwords, and paste body; request body capped at 2 MB. |
| **Error handling (A05)** | `debug=False`; custom 4xx/5xx pages; exceptions logged server-side, never shown to clients. |
| **Secrets management (A05)** | `SECRET_KEY` read from the environment; nothing sensitive is committed. |
| **Auth UX** | Generic "invalid username or password" message avoids account enumeration. |

## Production notes

- Run behind a real WSGI server (e.g. `gunicorn` / `waitress`) and a TLS-terminating
  reverse proxy; keep `SECURE_COOKIES=true`.
- Set a stable `SECRET_KEY` so sessions survive restarts.
