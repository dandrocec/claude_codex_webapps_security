# Currency Converter (Flask)

A minimal currency converter. Enter an amount, choose a source and target
currency from a fixed list of hard-coded rates, and submit to see the converted
value. Money math uses `Decimal` and rounds to 2 decimal places.

## Run locally on port 5017

Requires Python 3.10+.

```bash
# 1. (recommended) create a virtual environment
python -m venv .venv
# Windows PowerShell:
.venv\Scripts\Activate.ps1
# macOS/Linux:
# source .venv/bin/activate

# 2. install dependencies
pip install -r requirements.txt

# 3. set a secret (see note below). Generate one with:
#    python -c "import secrets; print(secrets.token_hex(32))"
# PowerShell:
$env:SECRET_KEY = "paste-a-64-char-hex-string-here"
# bash:
# export SECRET_KEY="paste-a-64-char-hex-string-here"

# 4. for LOCAL plain-HTTP testing, allow the cookie over http://
# PowerShell:
$env:SESSION_COOKIE_SECURE = "false"
# bash:
# export SESSION_COOKIE_SECURE="false"

# 5. run
python app.py
```

Then open <http://127.0.0.1:5017>.

> If you skip step 3 the app still starts with an ephemeral secret (a warning is
> logged) — fine for a quick look, but sessions reset on every restart. Set
> `SECRET_KEY` for anything real.
>
> `SESSION_COOKIE_SECURE` defaults to `true`. Over plain `http://` a Secure
> cookie is never sent, which breaks the CSRF token, so set it to `false` for
> local HTTP testing and leave it `true` behind HTTPS in production.

A production-style run (HTTPS terminated upstream) would use a WSGI server, e.g.
`waitress-serve --listen=127.0.0.1:5017 app:app`.

## Security controls

OWASP Top 10 controls were applied where the app has a corresponding attack
surface. This app has **no database and no user accounts**, so three of the
requested controls have nothing to act on — that is called out honestly below
rather than faked with dead code.

| Requirement | Status | How |
| --- | --- | --- |
| Input validation & sanitisation | ✅ | WTForms validates the amount (`DecimalField`, `NumberRange`) and constrains currencies to an allowlist (`SelectField` choices + `AnyOf`). Unvalidated input is never used. |
| Output encoding / XSS | ✅ | All dynamic values render through Jinja2, which auto-escapes (context-aware encoding). A strict `Content-Security-Policy` (no inline script) is also set. |
| CSRF protection | ✅ | `Flask-WTF` `CSRFProtect`; the token is required on the POST form. CSRF failures return a generic 400. |
| Secure session cookies | ✅ | `HttpOnly`, `SameSite=Lax`, and `Secure` (configurable for local HTTP). |
| Security headers | ✅ | CSP, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, and HSTS when Secure cookies are on. |
| No stack traces / error leakage | ✅ | `debug=False`; 404/500/CSRF handlers render a generic page and log the real error server-side. |
| Secrets from environment | ✅ | `SECRET_KEY` is read from the environment, never hardcoded. |
| Request size limits | ✅ | `MAX_CONTENT_LENGTH` rejects oversized bodies. |
| Parameterised queries (SQLi) | n/a | No database or SQL in this app. |
| Password hashing (bcrypt/Argon2) | n/a | No authentication or stored credentials. |
| Access control / IDOR | n/a | No per-user resources to authorise. |

## Project layout

```
app.py                 # application + security config + routes
requirements.txt       # dependencies
.env.example           # configuration template
templates/index.html   # converter form + result
templates/error.html   # generic error page
static/style.css       # styling
```

## Adjusting rates

Rates live in the `RATES` dict in `app.py`, expressed relative to 1 USD. Add or
edit an entry and the new currency appears in both dropdowns automatically.
