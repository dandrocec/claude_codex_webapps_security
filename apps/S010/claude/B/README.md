# Secure File Upload (FastAPI)

A small web application where a signed-in user can upload files and download
their own uploads. Built with FastAPI and hardened against the OWASP Top 10.

## Features

- Register / log in (Argon2id password hashing, salted per password).
- Upload a file via a form; files are saved to the `uploads/` directory.
- A page lists **your** uploaded files with download links.
- SQLite metadata store using parameterised queries.

## Requirements

- Python 3.9+

## Run locally (port 5010)

```bash
# 1. Create and activate a virtual environment
python -m venv .venv
# Windows (PowerShell):
.venv\Scripts\Activate.ps1
# macOS / Linux:
# source .venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure environment (optional for local dev)
copy .env.example .env        # Windows
# cp .env.example .env        # macOS / Linux
# then set SECRET_KEY (see the comment in the file)

# 4. Start the app
python run.py
```

Open <http://127.0.0.1:5010/> in your browser. Register an account, then
upload and download files.

> If you do not set `SECRET_KEY`, a random one is generated at startup and you
> will see a warning. That is fine for a quick try, but sessions reset on every
> restart. Set `SECRET_KEY` for anything real.

### Environment variables

| Variable           | Default        | Purpose                                                        |
|--------------------|----------------|----------------------------------------------------------------|
| `SECRET_KEY`       | random (dev)   | Signs session cookies. **Set this in production.**             |
| `COOKIE_SECURE`    | `false`        | `true` over HTTPS → Secure cookie flag + HSTS header.          |
| `HOST` / `PORT`    | `127.0.0.1` / `5010` | Bind address.                                            |
| `MAX_UPLOAD_BYTES` | `5242880` (5 MB) | Maximum upload size.                                         |
| `UPLOAD_DIR`       | `./uploads`    | Where files are stored (not statically served).                |
| `DB_PATH`          | `./data/app.db`| SQLite database path.                                          |

## Allowed upload types

Validated by **inspecting file content** (magic bytes), not the filename or
the browser-supplied Content-Type: `png`, `jpg`, `gif`, `pdf`, `txt`.

## Security measures (OWASP Top 10)

- **Injection** — all SQL uses parameterised queries (`?` placeholders); HTML
  output is auto-escaped by Jinja2 (context-aware encoding) to prevent XSS.
- **Authentication** — passwords hashed with Argon2id (salted, memory-hard).
  Generic login errors avoid user enumeration; session ID is rotated on login
  to prevent fixation.
- **CSRF** — every state-changing POST requires a per-session CSRF token,
  compared in constant time; cookies are `SameSite=Lax`.
- **Access control / IDOR** — file queries are always scoped to the owning
  user, so you can only list and download your own files.
- **Sessions / cookies** — `HttpOnly` (always), `SameSite=Lax`, and `Secure`
  when `COOKIE_SECURE=true`.
- **Security headers** — CSP, `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, and HSTS
  (HTTPS only).
- **File upload hardening** — content-based type allow-list, max size enforced
  while streaming, server-generated random storage names, path-traversal
  guards, and downloads served as `attachment` with `octet-stream` (never
  executed/inline).
- **Error handling** — internal errors are logged server-side; clients get a
  generic message with no stack trace.
- **Secrets** — read from environment variables, never hardcoded.

## Project layout

```
app/
  main.py        # routes, middleware, error handlers
  config.py      # env-driven configuration
  db.py          # SQLite access (parameterised queries)
  security.py    # hashing, CSRF, validation, content sniffing
  templates/     # auto-escaped Jinja2 templates
run.py           # uvicorn entry point
requirements.txt
.env.example
```
