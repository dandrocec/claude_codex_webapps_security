# Greeting App

A tiny Flask web app: enter a name in a form, get greeted with
"Hello, &lt;name&gt;!". No database, no login.

## Requirements

- Python 3.9+

## Run it locally (port 5001)

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

### 2. Provide a secret key

The app reads its session/CSRF secret from the `SECRET_KEY` environment
variable and **never** uses a hardcoded default in production. Generate one:

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

**macOS / Linux**
```bash
export SECRET_KEY="<paste the generated value>"
```

**Windows (PowerShell)**
```powershell
$env:SECRET_KEY = "<paste the generated value>"
```

> For a quick local run you can instead set `FLASK_ENV=development`, which
> auto-generates an ephemeral key and serves cookies over plain HTTP.
> Do **not** use development mode for anything reachable by others.

### 3. Start the server

```bash
python app.py
```

Open <http://127.0.0.1:5001> in your browser.

## Security controls

This feature has no database, no passwords, and no per-user resources, so
the OWASP items that apply are implemented and the rest are noted as
out-of-scope for honesty.

| Control | Status | Where |
|---|---|---|
| CSRF protection on state-changing POST | ✅ | Flask-WTF `CSRFProtect`, token in `index.html` |
| XSS — context-aware output encoding | ✅ | Jinja2 autoescaping; strict `Content-Security-Policy` |
| Input validation & sanitisation | ✅ | `NameForm` validators (length + character allow-list) in `app.py` |
| Secure session cookies | ✅ | `HttpOnly`, `SameSite=Lax`, `Secure` (outside dev) in `app.py` |
| Security response headers | ✅ | `after_request` sets CSP, `X-Content-Type-Options`, `X-Frame-Options`, etc. |
| No secrets hardcoded | ✅ | `SECRET_KEY` read from environment; production refuses to start without it |
| No stack traces / internal errors leaked | ✅ | `debug=False` by default; generic error pages via error handlers |
| SQL injection / parameterised queries | N/A | No database or SQL in this app |
| Password hashing (bcrypt/Argon2) | N/A | No accounts or passwords |
| Broken access control / IDOR | N/A | No authenticated users or per-user resources |

If accounts or a database are added later, wire in parameterised queries,
Argon2/bcrypt password hashing, and per-user authorization checks at that point.
