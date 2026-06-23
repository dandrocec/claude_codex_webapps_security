# Blog API

A small REST API for a blog, built with **FastAPI** + **SQLAlchemy** (SQLite). It provides
JWT-based authentication, two roles (`author` and `admin`), full CRUD for posts, a login
endpoint, and an auto-generated OpenAPI schema.

## Features

- **JWT auth** via the OAuth2 password flow (`POST /auth/login`).
- **Roles**
  - *anyone* (no auth) can read published posts.
  - *author* can create posts and manage **their own** posts.
  - *admin* can manage **any** post.
- **CRUD** for posts: create, read, update (partial), delete.
- **OpenAPI schema** at `/openapi.json` with interactive docs at `/docs` and `/redoc`.
- **SQLite** storage (a `blog.db` file), created automatically on first run.

## Requirements

- Python 3.10+

## Run it locally (port 5083)

```bash
# 1. (Recommended) create and activate a virtual environment
python -m venv .venv
# Windows PowerShell:
.\.venv\Scripts\Activate.ps1
# macOS/Linux:
# source .venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Start the server on port 5083
uvicorn app.main:app --host 0.0.0.0 --port 5083 --reload
```

Then open:

- Swagger UI: http://localhost:5083/docs
- ReDoc: http://localhost:5083/redoc
- OpenAPI JSON: http://localhost:5083/openapi.json

## Demo accounts

Seeded automatically on first run (set `SEED_DEMO_DATA=false` to disable):

| Username | Password   | Role   |
|----------|------------|--------|
| `admin`  | `admin123` | admin  |
| `author` | `author123`| author |

## Quick walkthrough

### 1. Log in to get a token

```bash
curl -X POST http://localhost:5083/auth/login \
  -d "username=author&password=author123"
# -> {"access_token":"<JWT>","token_type":"bearer"}
```

In Swagger UI you can instead click **Authorize** and enter the username/password.

### 2. Use the token

```bash
TOKEN="<JWT from above>"

# Create a post
curl -X POST http://localhost:5083/posts \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Hello","content":"My first post","published":true}'

# List published posts (no auth required)
curl http://localhost:5083/posts

# List my own posts, including drafts
curl http://localhost:5083/posts/mine -H "Authorization: Bearer $TOKEN"

# Update a post (authors: own posts only; admins: any)
curl -X PUT http://localhost:5083/posts/1 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"published":false}'

# Delete a post
curl -X DELETE http://localhost:5083/posts/1 -H "Authorization: Bearer $TOKEN"
```

## Endpoints

| Method | Path             | Auth        | Description                                  |
|--------|------------------|-------------|----------------------------------------------|
| POST   | `/auth/login`    | none        | Get a JWT access token                       |
| GET    | `/auth/me`       | any user    | Current user info                            |
| GET    | `/posts`         | none        | List published posts                         |
| GET    | `/posts/{id}`    | none        | Get a single published post                  |
| GET    | `/posts/mine`    | any user    | List the caller's own posts (incl. drafts)   |
| POST   | `/posts`         | author/admin| Create a post                                |
| PUT    | `/posts/{id}`    | owner/admin | Update a post                                |
| DELETE | `/posts/{id}`    | owner/admin | Delete a post                                |

## Configuration

Settings can be overridden via environment variables or a `.env` file:

| Variable                      | Default                       | Description                       |
|-------------------------------|-------------------------------|-----------------------------------|
| `DATABASE_URL`                | `sqlite:///./blog.db`         | SQLAlchemy database URL           |
| `SECRET_KEY`                  | *(dev placeholder)*           | JWT signing key — **change it**   |
| `ALGORITHM`                   | `HS256`                       | JWT algorithm                     |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `60`                          | Token lifetime in minutes         |
| `SEED_DEMO_DATA`              | `true`                        | Seed demo users/posts on startup  |

> **Note:** Change `SECRET_KEY` before deploying anywhere real.
