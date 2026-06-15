# Secure Contact Form

A small Flask app with a public contact form and an authenticated admin page.
Visitors submit **name, email, message** and an **optional website URL**; when a
URL is supplied the server fetches the page (behind an SSRF guard) and shows a
small preview (title + first lines). Submitted messages are stored in SQLite and
listed on the admin page.

## Requirements

- Python 3.10+ (tested on 3.14)

## Run locally (port 5044)

```bash
# 1. Create and activate a virtual environment
python -m venv .venv
# Windows (PowerShell):
.venv\Scripts\Activate.ps1
# macOS/Linux:
# source .venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. (recommended) configure secrets
#    copy .env.example, then export the values, OR set them inline as below.
#    On first run an "admin" account is created from ADMIN_USERNAME/ADMIN_PASSWORD.

# Windows (PowerShell):
$env:SECRET_KEY = python -c "import secrets; print(secrets.token_hex(32))"
$env:ADMIN_USERNAME = "admin"
$env:ADMIN_PASSWORD = "change-me-to-a-strong-passphrase"

# macOS/Linux:
# export SECRET_KEY=$(python -c "import secrets; print(secrets.token_hex(32))")
# export ADMIN_USERNAME=admin
# export ADMIN_PASSWORD=change-me-to-a-strong-passphrase

# 4. Start the app
python app.py
```

Open <http://127.0.0.1:5044/>.

- Contact form: `/`
- Admin login: `/login` (then `/admin`)

If you do not set `ADMIN_PASSWORD`, a random one is generated and printed to the
console on first run.

### Production note

The session cookie's `Secure` flag and HSTS are enabled only when
`COOKIE_SECURE=true`, which requires serving over HTTPS (e.g. behind a TLS
terminating reverse proxy). Keep it `false` for local plain-HTTP testing,
otherwise the browser will not send the session cookie and admin login will
appear to fail.

## Security controls

| Area | Control |
|------|---------|
| **SQL injection** | All queries use parameterised statements (`?` placeholders). |
| **Password storage** | Argon2id via `argon2-cffi`, per-password salt, auto-rehash. |
| **XSS** | Jinja2 autoescaping (context-aware) on all output; strict CSP. |
| **CSRF** | Flask-WTF `CSRFProtect` token required on every state-changing POST. |
| **Access control / IDOR** | Admin routes require an authenticated session; delete checks the row exists and acts only via the server-side identity. |
| **Session cookies** | `HttpOnly`, `SameSite=Lax`, `Secure` (when `COOKIE_SECURE=true`); session fixation avoided by clearing the session on login. |
| **Security headers** | CSP, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, HSTS (HTTPS). |
| **Error handling** | `debug=False`; generic error pages, full detail logged server-side only. |
| **Secrets** | Read from environment variables; nothing hardcoded. |
| **Open redirect** | The post-login `next` parameter only allows local paths. |
| **Request size** | Inbound bodies capped via `MAX_CONTENT_LENGTH`. |

### SSRF protection for the URL preview

The outbound fetcher (`fetch_preview` in `app.py`) enforces:

- **Scheme allow-list** — only `http` / `https`.
- **Host/IP validation** — the hostname is resolved and every candidate
  address is checked; private, loopback, link-local, reserved, multicast and
  unspecified ranges are blocked (covers `127.0.0.0/8`, `10.0.0.0/8`,
  `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16` incl. the
  `169.254.169.254` cloud-metadata endpoint, `::1`, `fc00::/7`, …).
- **DNS-rebinding defence** — a custom transport adapter re-validates the
  *actually connected* peer IP at socket-connect time, not just the
  pre-resolved address.
- **Redirects** — not followed automatically; each `Location` hop is
  re-validated against all the rules above (max 3 hops).
- **Timeouts & size cap** — connect/read timeouts and a maximum response size
  (default 512 KiB) so a slow or huge target cannot exhaust resources.
- **Content type** — only HTML/text documents are parsed for the preview.

## Project layout

```
app.py                 # application + security logic
requirements.txt       # dependencies
.env.example           # configuration template
templates/             # Jinja2 templates (autoescaped)
static/style.css       # styling
```
