# Inspirational Quote App

A tiny Flask web app that shows a random inspirational quote from a built-in
list on every page load, with a **"Show another quote"** button that fetches a
new one without reloading the page.

## Requirements

- Python 3.9+

## Run locally (port 5014)

```bash
# 1. (optional) create and activate a virtual environment
python -m venv .venv
# Windows PowerShell:
.\.venv\Scripts\Activate.ps1
# macOS / Linux:
# source .venv/bin/activate

# 2. install dependencies
pip install -r requirements.txt

# 3. set a secret key (required for secure sessions / CSRF)
# Windows PowerShell:
$env:SECRET_KEY = python -c "import secrets; print(secrets.token_hex(32))"
# macOS / Linux:
# export SECRET_KEY=$(python -c "import secrets; print(secrets.token_hex(32))")

# 4. run
python app.py
```

Then open <http://127.0.0.1:5014/>.

> If `SECRET_KEY` is not set, the app generates an ephemeral key for local
> development and logs a warning. Always set a fixed `SECRET_KEY` in production.

### Environment variables

| Variable      | Default | Purpose                                                             |
|---------------|---------|---------------------------------------------------------------------|
| `SECRET_KEY`  | random  | Signs the session cookie / CSRF token. **Set this in production.**   |
| `FORCE_HTTPS` | `false` | Set to `true` when served over HTTPS to enable `Secure` cookies + HSTS. |

## Security notes (OWASP Top 10)

This app has **no database and no user accounts**, so some requested controls
have no attack surface here. The table records how each requirement is handled.

| Requirement | Status |
|-------------|--------|
| **XSS** — context-aware output encoding | Jinja2 autoescaping for server-rendered output; client JS uses `textContent`, never `innerHTML`. |
| **CSRF** | `Flask-WTF` `CSRFProtect` enabled globally; the quote button uses a safe read-only `GET` (not state-changing). |
| **Secure session cookies** | `HttpOnly`, `SameSite=Lax`, and `Secure` (when `FORCE_HTTPS=true`). |
| **Security headers** | CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, and HSTS over HTTPS. |
| **No secret hardcoding** | `SECRET_KEY` read from the environment. |
| **No error/stack-trace leakage** | `debug=False`; custom 404/500 pages with no internal detail. |
| **SQL injection** (parameterised queries) | N/A — no database. Pattern would apply if one were added. |
| **Password hashing** (bcrypt/Argon2) | N/A — no authentication. |
| **Access control / IDOR** | N/A — no per-user resources. |
| **Input validation** | No user-supplied input is accepted; quotes come from a trusted built-in list. |
```
