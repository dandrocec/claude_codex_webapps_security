# Identity Provider (FastAPI)

A minimal OpenID Connect / OAuth 2.0 identity provider built with FastAPI. It lets
users register and log in, lets them register client applications, and issues
RS256-signed tokens that client apps verify with the published public key (JWKS).

## Features

- **User auth** — registration, login, logout with server-side sessions.
- **Client management** — an admin page where signed-in users register and delete
  their own OAuth clients (client secrets shown once).
- **OAuth 2.0 / OIDC** — authorization code flow with PKCE (S256):
  - `GET  /oauth/authorize` — login + consent, issues an authorization code
  - `POST /oauth/token` — exchanges the code for a signed access token + ID token
  - `GET/POST /userinfo` — returns claims for a bearer access token
  - `GET /.well-known/openid-configuration` — discovery document
  - `GET /.well-known/jwks.json` — public keys for verifying tokens

## Security controls (OWASP Top 10)

- **SQL injection** — SQLAlchemy ORM only; all queries are parameterised.
- **Password storage** — Argon2id (salted, memory-hard) via `argon2-cffi`.
- **XSS** — Jinja2 autoescaping (context-aware output encoding); strict CSP; all
  input validated/normalised before use.
- **CSRF** — synchroniser token on every state-changing form (login, register,
  logout, consent, client create/delete).
- **Access control / IDOR** — clients are owned by users; ownership is checked on
  every mutation. `redirect_uri` must exactly match a pre-registered value.
- **Session cookies** — `HttpOnly`, `SameSite=Lax`, and `Secure` (enable via
  `COOKIE_SECURE=true` behind HTTPS). Session ID is rotated on login/registration
  to prevent fixation.
- **Security headers** — CSP, `X-Content-Type-Options`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `Permissions-Policy`, and HSTS (when `COOKIE_SECURE=true`).
- **Error handling** — custom handlers return generic messages; no stack traces
  or internals are sent to clients.
- **Secrets** — read from environment variables; nothing sensitive is hardcoded.
  The RSA signing key and session secret are generated on first run if not
  provided (and the signing key is persisted to `keys/` with `0600` perms).

## Requirements

- Python 3.11+

## Run locally on port 5099

```bash
# 1. Create and activate a virtual environment
python -m venv .venv
# Windows (PowerShell):
.venv\Scripts\Activate.ps1
# macOS/Linux:
# source .venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. (Optional) configure environment
cp .env.example .env        # then edit values; export them or use a loader
#   At minimum, set SESSION_SECRET for stable sessions:
#   python -c "import secrets;print(secrets.token_urlsafe(48))"
#   Optionally set ADMIN_USERNAME / ADMIN_PASSWORD to seed an admin account.

# 4. Start the server on port 5099
uvicorn app.main:app --host 127.0.0.1 --port 5099
```

Then open <http://localhost:5099>.

> The app reads configuration from real environment variables. The `.env` file is
> for your convenience — export the variables in your shell (or use a tool such as
> `python-dotenv`/`direnv`) before launching, e.g. on PowerShell:
> `$env:SESSION_SECRET = "..."`.

### Production note on cookies

For local `http://localhost` development, `COOKIE_SECURE` defaults to `false` so the
session cookie is sent over plain HTTP. **In production, serve over HTTPS and set
`COOKIE_SECURE=true`** so cookies get the `Secure` flag and HSTS is enabled.

## Try the OAuth flow

1. Register a user and log in.
2. Go to **Clients**, create a client with redirect URI
   `http://localhost:8080/callback`, and copy the `client_id` / `client_secret`.
3. Direct a browser to:
   ```
   http://localhost:5099/oauth/authorize?response_type=code&client_id=CLIENT_ID
     &redirect_uri=http://localhost:8080/callback&scope=openid%20profile%20email&state=xyz
   ```
4. Approve consent. You are redirected to the callback with `?code=...&state=xyz`.
5. Exchange the code:
   ```bash
   curl -X POST http://localhost:5099/oauth/token \
     -d grant_type=authorization_code \
     -d code=THE_CODE \
     -d redirect_uri=http://localhost:8080/callback \
     -d client_id=CLIENT_ID \
     -d client_secret=CLIENT_SECRET
   ```
6. Call userinfo with the returned access token:
   ```bash
   curl http://localhost:5099/userinfo -H "Authorization: Bearer ACCESS_TOKEN"
   ```

Clients verify tokens using the public keys at
`http://localhost:5099/.well-known/jwks.json` (algorithm `RS256`).

## Project layout

```
app/
  main.py          # app wiring, middleware, security headers, error handlers
  config.py        # env-driven settings
  database.py      # SQLAlchemy engine/session
  models.py        # User, Client, AuthorizationCode
  security.py      # Argon2id password/secret hashing
  keys.py          # RSA key management + JWT sign/verify, JWKS
  csrf.py          # CSRF token helpers
  validators.py    # input validation
  deps.py          # current-user dependency + templates
  routers/
    auth.py        # register / login / logout / home
    admin.py       # client management (ownership-scoped)
    oauth.py       # authorize / token / userinfo / discovery / jwks
  templates/       # Jinja2 templates (autoescaped)
  static/          # CSS
requirements.txt
.env.example
```
