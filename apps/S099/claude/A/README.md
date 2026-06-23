# FastAPI Identity Provider

A small but complete OpenID-Connect / OAuth2 **identity provider** built with FastAPI.
It registers client applications, authenticates users, and issues **RS256-signed JWTs**
that client apps can verify against the published public keys (JWKS).

## Features

- **Authorization-code flow** (`/authorize` → `/token`)
- **Signed tokens** — access token + ID token, signed with an RSA key generated on first run
- **JWKS endpoint** so relying parties can verify tokens offline
- **`/userinfo`** endpoint that validates the bearer token signature and returns claims
- **OIDC discovery** document at `/.well-known/openid-configuration`
- **Admin web page** to register and delete client applications
- **SQLite database** (via SQLAlchemy) storing users, clients, and authorization codes
- Auto-seeded admin user and a demo client so it works out of the box

## Requirements

- Python 3.10+

## Run locally on port 5099

```bash
# 1. (recommended) create a virtual environment
python -m venv .venv
# Windows:  .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate

# 2. install dependencies
pip install -r requirements.txt

# 3. start the server on port 5099
uvicorn app.main:app --host 0.0.0.0 --port 5099 --reload
```

On first start the app will:
- create `idp.db` (SQLite),
- generate an RSA signing keypair under `keys/`,
- seed an admin user and a demo client.

| What            | Value                         |
| --------------- | ----------------------------- |
| Admin login     | `admin` / `admin123`          |
| Demo client id  | `demo-client`                 |
| Demo secret     | `demo-secret`                 |
| Demo redirect   | `http://localhost:5099/callback-demo` |

Open the admin page: <http://localhost:5099/admin/login>

> Override defaults with `IDP_`-prefixed env vars (e.g. `IDP_SEED_ADMIN_PASSWORD`,
> `IDP_ISSUER`, `IDP_SESSION_SECRET`). See `app/config.py`.

## Endpoints

| Method   | Path                                  | Purpose                                  |
| -------- | ------------------------------------- | ---------------------------------------- |
| GET      | `/authorize`                          | Begin login; issues an authorization code |
| POST     | `/login`                              | Submit user credentials                  |
| POST     | `/token`                              | Exchange code for `access_token`/`id_token` |
| GET      | `/userinfo`                           | Return claims for a valid bearer token   |
| GET      | `/.well-known/jwks.json`              | Public verification keys                 |
| GET      | `/.well-known/openid-configuration`   | Discovery document                       |
| GET/POST | `/admin/...`                          | Manage client applications               |

Interactive API docs are available at <http://localhost:5099/docs>.

## Try the full flow (with the demo client)

1. **Authorize** — open this in a browser and sign in as `admin` / `admin123`:

   ```
   http://localhost:5099/authorize?response_type=code&client_id=demo-client&redirect_uri=http://localhost:5099/callback-demo&scope=openid%20profile%20email&state=xyz
   ```

   You'll be redirected to `…/callback-demo?code=<CODE>&state=xyz`. Copy the `code`.

2. **Exchange the code for tokens:**

   ```bash
   curl -X POST http://localhost:5099/token \
     -d grant_type=authorization_code \
     -d code=<CODE> \
     -d redirect_uri=http://localhost:5099/callback-demo \
     -d client_id=demo-client \
     -d client_secret=demo-secret
   ```

3. **Call userinfo with the access token:**

   ```bash
   curl http://localhost:5099/userinfo \
     -H "Authorization: Bearer <ACCESS_TOKEN>"
   ```

Client apps verify the `id_token`/`access_token` signature using the keys at
`/.well-known/jwks.json` (RS256).

## Project layout

```
app/
  main.py        FastAPI app + all routes
  config.py      settings (env-overridable)
  database.py    SQLAlchemy engine/session
  models.py      User, Client, AuthorizationCode
  security.py    password hashing, RSA keys, JWT issue/verify
  seed.py        table creation + initial seed data
  templates/     login + admin HTML
requirements.txt
```
