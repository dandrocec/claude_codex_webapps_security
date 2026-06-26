# FastAPI Identity Provider

A small OAuth-style identity provider with user registration/login, client registration, token issuance, userinfo, and an admin page for managing client applications.

## Run locally on port 5099

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
$env:IDP_SESSION_SECRET="replace-with-a-long-random-value"
$env:IDP_JWT_SECRET="replace-with-a-different-long-random-value"
$env:IDP_ADMIN_EMAIL="admin@example.com"
$env:IDP_ADMIN_PASSWORD="change-this-admin-password"
$env:COOKIE_SECURE="false"
uvicorn app.main:app --host 127.0.0.1 --port 5099
```

Open `http://127.0.0.1:5099/`.

For production, use HTTPS, strong random secrets, a production database URL in `DATABASE_URL`, and keep `COOKIE_SECURE=true` or unset.

## Main endpoints

- `GET /login` and `POST /login` - browser login
- `GET /register` and `POST /register` - user registration
- `POST /token` - password grant token endpoint for registered clients
- `GET /userinfo` - bearer-token user profile endpoint
- `GET /admin/clients` - admin page for client management
