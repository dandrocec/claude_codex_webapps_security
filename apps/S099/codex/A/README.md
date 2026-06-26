# FastAPI Identity Provider

A small OpenID Connect-style identity provider built with FastAPI. It stores users
and OAuth clients in SQLite, authenticates users, issues signed JWT access tokens,
and exposes login, token, userinfo, client registration, and admin pages.

## Run locally on port 5099

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 5099
```

Open `http://127.0.0.1:5099/admin`.

Default accounts created on first startup:

- Admin: `admin@example.com` / `admin123`
- User: `user@example.com` / `user123`

The first sample client is also created automatically:

- Client ID: `demo-client`
- Client secret: `demo-secret`
- Redirect URI: `http://127.0.0.1:5099/callback`

## Useful endpoints

- `GET /authorize` - browser login flow that returns an authorization code
- `POST /token` - exchanges an authorization code or password credentials for a JWT
- `GET /userinfo` - returns the authenticated user's profile from a bearer token
- `POST /clients/register` - registers a client application
- `GET /admin` - HTML admin page for managing clients
- `GET /.well-known/openid-configuration` - provider metadata
