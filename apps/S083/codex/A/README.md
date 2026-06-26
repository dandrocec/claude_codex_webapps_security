# FastAPI Blog REST API

A runnable FastAPI blog API with JWT authentication, author/admin roles, and SQLite database storage.

## Run locally

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 5083
```

Open the interactive OpenAPI docs at:

```text
http://localhost:5083/docs
```

The raw OpenAPI schema is available at:

```text
http://localhost:5083/openapi.json
```

## Seed users

The app creates two default users on startup:

| Username | Password | Role |
| --- | --- | --- |
| `author` | `authorpass` | `author` |
| `admin` | `adminpass` | `admin` |

## Main endpoints

- `POST /auth/login` returns a JWT access token.
- `GET /posts` lists published posts for anonymous users and visible manageable posts for authenticated users.
- `GET /posts/{post_id}` reads a published post, or an owned/admin-visible draft.
- `POST /posts` creates a post as an authenticated author or admin.
- `PUT /posts/{post_id}` updates a post owned by the author or any post as admin.
- `DELETE /posts/{post_id}` deletes a post owned by the author or any post as admin.

Use the `Authorization: Bearer <token>` header for authenticated requests.
