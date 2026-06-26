# FastAPI Blog API

A FastAPI REST API for blog posts with JWT authentication, author/admin roles, CSRF checks, secure cookies, security headers, input validation, bcrypt password hashing, and SQLAlchemy-backed database storage.

## Run locally on port 5083

Create environment variables first:

```powershell
$env:JWT_SECRET = "replace-with-a-long-random-secret"
$env:DATABASE_URL = "sqlite:///./blog.db"
$env:COOKIE_SECURE = "false"
$env:ADMIN_EMAIL = "admin@example.com"
$env:ADMIN_PASSWORD = "replace-with-a-strong-admin-password"
```

Install and start:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 5083
```

OpenAPI schema is available at:

- `http://localhost:5083/openapi.json`
- `http://localhost:5083/docs`

## API overview

- `GET /auth/csrf` issues the CSRF cookie/token required for state-changing requests.
- `POST /auth/register` creates an author account.
- `POST /auth/login` returns a JWT and rotates secure auth/CSRF cookies.
- `POST /posts` creates a post for the current author/admin.
- `GET /posts` lists published posts for everyone; authenticated users also see their own drafts, and admins see all posts.
- `GET /posts/{post_id}` reads a published post, own post, or any post for admins.
- `PUT /posts/{post_id}` updates an owned post, or any post for admins.
- `DELETE /posts/{post_id}` deletes an owned post, or any post for admins.

For every state-changing request, first call `GET /auth/csrf`, then send the returned token in the `X-CSRF-Token` header while preserving the `csrf_token` cookie.
