# Secure Blog API

A blog REST API built with **FastAPI** + **SQLAlchemy**, featuring JWT
authentication, `author` / `admin` roles, and OWASP Top 10–aligned security
controls.

## Features

- **CRUD for posts** with role- and ownership-based access control.
- **Authors** manage only their own posts; **admins** manage any post.
- **Anyone** can read published posts (no auth required).
- **Login / logout** endpoints issuing JWTs.
- Interactive **OpenAPI** docs at `/docs` and the raw schema at `/openapi.json`.
- SQL storage via SQLAlchemy ORM (SQLite by default, any SQL DB via `DATABASE_URL`).

## Roles & permissions

| Action                       | Anonymous | Author          | Admin |
|------------------------------|:---------:|:---------------:|:-----:|
| Read published posts         | ✅        | ✅              | ✅    |
| Create post                  | ❌        | ✅              | ✅    |
| Update / delete own post     | ❌        | ✅              | ✅    |
| Update / delete others' post | ❌        | ❌              | ✅    |
| List own posts (`/posts/mine`)| ❌       | ✅              | ✅    |
| Create users with any role   | ❌        | ❌              | ✅    |

## Running locally (port 5083)

Requires Python 3.11+.

```bash
# 1. Create and activate a virtual environment
python -m venv .venv
# Windows (PowerShell):
.venv\Scripts\Activate.ps1
# macOS / Linux:
# source .venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure environment
cp .env.example .env          # Windows: copy .env.example .env
# Generate a strong secret and paste it into SECRET_KEY in .env:
python -c "import secrets; print(secrets.token_urlsafe(64))"
# To get a seeded admin on first run, set SEED_ADMIN_PASSWORD in .env.

# 4. Run on port 5083
uvicorn app.main:app --host 0.0.0.0 --port 5083
```

Then open:

- Swagger UI: <http://localhost:5083/docs>
- OpenAPI schema: <http://localhost:5083/openapi.json>
- Health check: <http://localhost:5083/health>

> **Local cookie testing:** cookies are issued with the `Secure` flag by default,
> which browsers won't send over plain `http`. For pure API testing, use the
> **Bearer token** returned by `/auth/login` (no CSRF needed). To test the
> cookie flow over `http`, set `COOKIE_SECURE=false` in `.env`. **Always keep it
> `true` in production (HTTPS).**

## Quick start with cURL (Bearer flow)

```bash
# Register an author
curl -X POST http://localhost:5083/users/register \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"correct horse battery"}'

# Log in -> returns access_token + csrf_token
TOKEN=$(curl -s -X POST http://localhost:5083/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"correct horse battery"}' \
  | python -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

# Create a post (Bearer auth is exempt from CSRF)
curl -X POST http://localhost:5083/posts \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Hello","content":"My first post","published":true}'

# Read published posts (no auth)
curl http://localhost:5083/posts
```

## Authentication model

Login returns a JWT **two ways**:

1. **`Authorization: Bearer <token>`** header — best for API clients/scripts.
   Not vulnerable to CSRF, so CSRF checks are skipped for this mode.
2. **HttpOnly cookie** (`access_token`) — best for browsers. State-changing
   requests must use the **double-submit CSRF token**: send the value of the
   readable `csrf_token` cookie back in the `X-CSRF-Token` header.

## Security controls (OWASP Top 10)

- **A01 Broken Access Control / IDOR** — every write re-checks ownership
  (`author_id == user.id`) or admin role; non-owners get `404`, not `403`,
  to avoid resource enumeration.
- **A02 Cryptographic Failures** — passwords hashed with **Argon2id** (salted,
  memory-hard); JWTs signed with an env-provided secret; secure cookies.
- **A03 Injection** — all DB access via the SQLAlchemy ORM (parameterised
  queries). Input is validated by Pydantic and **sanitised with `bleach`**;
  HTML in post bodies is restricted to a safe tag allowlist (XSS prevention),
  and JSON responses are context-safe.
- **A04 Insecure Design** — least privilege (self-registration is always
  `author`); generic auth errors prevent username enumeration.
- **A05 Security Misconfiguration** — strict security headers (CSP, HSTS,
  `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, etc.);
  CORS restricted to explicit origins.
- **A07 Identification & Auth Failures** — Argon2, short-lived JWTs with `jti`,
  HttpOnly + `Secure` + `SameSite=Strict` cookies, transparent hash upgrades.
- **CSRF** — double-submit cookie token enforced on all cookie-authenticated,
  state-changing requests.
- **A09 Logging Failures / info leakage** — global exception handler logs
  details server-side and returns generic messages; no stack traces to clients.
- **Secrets** — `SECRET_KEY`, `DATABASE_URL`, etc. read from the environment;
  nothing sensitive hardcoded.

## API summary

| Method | Path                | Auth        | Description                         |
|--------|---------------------|-------------|-------------------------------------|
| POST   | `/auth/login`       | none        | Log in, receive JWT + CSRF token    |
| POST   | `/auth/logout`      | user        | Clear auth cookies                  |
| GET    | `/auth/me`          | user        | Current user info                   |
| POST   | `/users/register`   | none        | Register a new author               |
| POST   | `/users`            | admin       | Create a user with any role         |
| GET    | `/posts`            | none        | List published posts                |
| GET    | `/posts/{id}`       | none        | Read a published post               |
| GET    | `/posts/mine`       | user        | List your own posts                 |
| POST   | `/posts`            | user        | Create a post                       |
| PUT    | `/posts/{id}`       | owner/admin | Update a post                       |
| DELETE | `/posts/{id}`       | owner/admin | Delete a post                       |

## Production notes

- Set a strong `SECRET_KEY` and keep `COOKIE_SECURE=true` behind HTTPS.
- Use a managed database via `DATABASE_URL` and real migrations (Alembic)
  instead of `create_all`.
- Run behind a TLS-terminating reverse proxy.
