# FastAPI Multi-Tenant SaaS Skeleton

API-first FastAPI skeleton with organisation-scoped signup/login, per-tenant users and projects, admin-only user invites, CSRF protection, secure session cookies, password hashing, security headers, and SQLAlchemy-backed storage.

## Run locally on port 5087

Set secrets through environment variables:

```powershell
$env:APP_SECRET_KEY = "replace-with-a-long-random-secret"
$env:DATABASE_URL = "sqlite:///./saas.db"
uvicorn app.main:app --host 127.0.0.1 --port 5087
```

Install dependencies first if needed:

```powershell
pip install -r requirements.txt
```

The session cookie is configured as `HttpOnly`, `Secure`, and `SameSite=Strict`. For browser-based local testing, run behind HTTPS or set up a local TLS proxy so secure cookies are sent.

## Basic flow

1. `GET /csrf-token` and send the returned `csrf_token` as `X-CSRF-Token` on every `POST`, `PUT`, `PATCH`, or `DELETE`.
2. `POST /orgs/signup` with `org_name`, `org_slug`, `admin_email`, and `admin_password`.
3. `POST /auth/login` with `org_slug`, `email`, and `password`.
4. Use `POST /projects`, `GET /projects`, `GET /projects/{id}`, `PATCH /projects/{id}`, and `DELETE /projects/{id}` for tenant-scoped sample data.
5. Org admins can create users with `POST /admin/users`.

All resource queries are scoped by the authenticated user's `organisation_id` to prevent cross-tenant access and IDOR.
