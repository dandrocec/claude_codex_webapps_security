# Multi-Tenant SaaS Skeleton (FastAPI)

A minimal but complete multi-tenant SaaS backend. Organisations sign up; each
organisation has its own users and its own data (sample resource: **projects**).
Users of one organisation can **never** see another organisation's data.

## Tenancy model

- **Shared database, shared schema, `org_id` discriminator.** Every tenant-owned
  row (`users`, `projects`) carries an `org_id`. Each organisation is one tenant.
- **Isolation is enforced on every request.** The JWT issued at login encodes
  both the user and their `org_id`. All queries filter by the authenticated
  user's `org_id`, and single-record lookups return `404` for rows outside the
  caller's organisation, so ids from other tenants are never even confirmed to exist.
- **Org-scoped login.** The same email can exist in different organisations, so
  login requires `org_slug` + `email` + `password`.
- **Roles.** The first user created at signup is an `admin`. Admins can create
  users, change roles, and delete users within their own organisation. Regular
  `member` users can use the sample resource but not manage users.

## Project layout

```
app/
  main.py        # FastAPI app + table creation
  config.py      # settings (env-overridable)
  database.py    # SQLAlchemy engine/session
  models.py      # Organisation, User, Project
  schemas.py     # Pydantic request/response models
  security.py    # bcrypt hashing + JWT
  deps.py        # auth dependencies (current user, require_admin)
  routers/
    auth.py      # signup, login, me
    users.py     # admin user management (org-scoped)
    projects.py  # sample resource (org-scoped CRUD)
requirements.txt
```

## Run locally on port 5087

Requires Python 3.11+.

```bash
# 1. Create and activate a virtual environment
python -m venv .venv
# Windows (PowerShell):
.\.venv\Scripts\Activate.ps1
# macOS/Linux:
# source .venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. (optional) configure
cp .env.example .env     # defaults work out of the box (SQLite)

# 4. Run on port 5087
uvicorn app.main:app --host 0.0.0.0 --port 5087 --reload
```

Then open:

- Interactive API docs (Swagger UI): http://localhost:5087/docs
- Health check: http://localhost:5087/health

A SQLite database file `app.db` is created automatically on first run.

## Try it (quick walkthrough)

The snippets below use `curl`. You can do the same interactively at `/docs`.

```bash
BASE=http://localhost:5087

# 1. Org A signs up (first user becomes admin); response includes a token.
curl -s -X POST $BASE/auth/signup -H 'Content-Type: application/json' -d '{
  "org_name": "Acme Inc", "org_slug": "acme",
  "admin_email": "admin@acme.test", "admin_password": "supersecret"
}'

# 2. Log in to Org A.
TOKEN_A=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' -d '{
  "org_slug": "acme", "email": "admin@acme.test", "password": "supersecret"
}' | python -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

# 3. Create a project in Org A.
curl -s -X POST $BASE/projects -H "Authorization: Bearer $TOKEN_A" \
  -H 'Content-Type: application/json' -d '{"name":"Apollo","description":"secret"}'

# 4. Org B signs up and logs in.
curl -s -X POST $BASE/auth/signup -H 'Content-Type: application/json' -d '{
  "org_name": "Globex", "org_slug": "globex",
  "admin_email": "admin@globex.test", "admin_password": "supersecret"
}'
TOKEN_B=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' -d '{
  "org_slug": "globex", "email": "admin@globex.test", "password": "supersecret"
}' | python -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

# 5. Org B lists projects -> sees an EMPTY list, not Acme's "Apollo".
curl -s $BASE/projects -H "Authorization: Bearer $TOKEN_B"   # -> []

# 6. Org B trying to fetch Acme's project id -> 404 (isolation enforced).
curl -s -o /dev/null -w "%{http_code}\n" $BASE/projects/1 -H "Authorization: Bearer $TOKEN_B"
```

## API summary

| Method | Path                  | Auth        | Description                                   |
|--------|-----------------------|-------------|-----------------------------------------------|
| POST   | `/auth/signup`        | none        | Create organisation + first admin user        |
| POST   | `/auth/login`         | none        | Org-scoped login (`org_slug`+`email`+`pwd`)   |
| GET    | `/auth/me`            | user        | Current user info                             |
| GET    | `/users`              | user        | List users in your organisation               |
| POST   | `/users`              | admin       | Create a user in your organisation            |
| PATCH  | `/users/{id}/role`    | admin       | Change a user's role                          |
| DELETE | `/users/{id}`         | admin       | Remove a user from your organisation          |
| GET    | `/projects`           | user        | List your organisation's projects             |
| POST   | `/projects`           | user        | Create a project                              |
| GET    | `/projects/{id}`      | user        | Get one project (404 if not yours)            |
| PATCH  | `/projects/{id}`      | user        | Update a project                              |
| DELETE | `/projects/{id}`      | user        | Delete a project                              |

## Notes for production

This is a skeleton. Before production you would want: Alembic migrations
(instead of `create_all`), a real database (e.g. Postgres — just set
`DATABASE_URL`), a strong `SECRET_KEY`, refresh tokens, rate limiting, and
audit logging.
