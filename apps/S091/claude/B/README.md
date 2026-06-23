# Microblog (FastAPI)

A small but complete microblog. Users register, post short messages, follow each
other, and read a timeline. A **background worker** fans posts out into
per-user feeds and fetches **link previews** for URLs found in posts — through an
**SSRF-hardened** fetcher. It ships with both a **REST API** and a minimal
server-rendered **web UI**.

* **Web framework:** FastAPI + Uvicorn
* **Storage:** SQLAlchemy ORM over SQLite (parameterised queries throughout)
* **Task queue:** a durable, database-backed queue (`tasks` table) drained by a
  worker — runs in-process by default, or as a separate process.
* **Templates:** Jinja2 (autoescaped output)

## Requirements

* Python 3.11+

## Run it locally (port 5091)

```bash
# 1. Create and activate a virtual environment
python -m venv .venv
# Windows (PowerShell):
.\.venv\Scripts\Activate.ps1
# macOS/Linux:
# source .venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure environment (a strong SECRET_KEY is recommended)
copy .env.example .env        # Windows
# cp .env.example .env        # macOS/Linux
#  -> edit .env and set SECRET_KEY. The app also reads plain environment
#     variables, so a .env file is optional for a quick local run.

# 4. Start the app (also starts the in-process worker)
python run.py
```

Then open <http://localhost:5091>.

> The app reads configuration from real environment variables. The `.env` file
> is provided for convenience; load it into your shell, or export the variables
> yourself. On PowerShell you can set the secret for a session with:
> `$env:SECRET_KEY = "$(python -c 'import secrets;print(secrets.token_urlsafe(48))')"`

### Running the worker separately (optional)

Set `WORKER_ENABLED=false` and run the worker in its own process:

```bash
# terminal 1
python run.py
# terminal 2
python worker.py
```

## REST API

All state-changing requests require a CSRF token. Fetch one (it also sets your
session cookie), then send it in the `X-CSRF-Token` header. Use a cookie jar.

```bash
# Get a CSRF token + session cookie
curl -c jar.txt -b jar.txt http://localhost:5091/api/csrf
# -> {"csrf_token":"..."}

# Register
curl -c jar.txt -b jar.txt -H "Content-Type: application/json" \
     -H "X-CSRF-Token: <token>" \
     -d '{"username":"alice","password":"hunter2hunter2"}' \
     http://localhost:5091/api/register

# Log in
curl -c jar.txt -b jar.txt -H "Content-Type: application/json" \
     -H "X-CSRF-Token: <token>" \
     -d '{"username":"alice","password":"hunter2hunter2"}' \
     http://localhost:5091/api/login

# Post (URLs get previews via the worker)
curl -c jar.txt -b jar.txt -H "Content-Type: application/json" \
     -H "X-CSRF-Token: <token>" \
     -d '{"content":"hello world https://example.com"}' \
     http://localhost:5091/api/posts
```

| Method & path                         | Description                          | Auth |
|---------------------------------------|--------------------------------------|------|
| `GET  /api/csrf`                      | Get CSRF token for the session       | no   |
| `GET  /api/me`                        | Current user                         | no   |
| `POST /api/register`                  | Create account                       | csrf |
| `POST /api/login`                     | Log in                               | csrf |
| `POST /api/logout`                    | Log out                              | csrf |
| `POST /api/posts`                     | Create a post                        | yes  |
| `GET  /api/posts/{id}`                | Read a post                          | no   |
| `DELETE /api/posts/{id}`              | Delete your post (owner only)        | yes  |
| `GET  /api/timeline`                  | Your materialised feed               | yes  |
| `GET  /api/users/{username}`          | A user and their posts               | no   |
| `POST /api/users/{username}/follow`   | Follow                               | yes  |
| `DELETE /api/users/{username}/follow` | Unfollow                             | yes  |

## How the background work flows

1. Creating a post enqueues a `fanout` task and one `link_preview` task per URL.
2. `fanout` writes a `feed_entries` row for the author and every follower; the
   timeline reads from that materialised feed.
3. Following someone enqueues a `backfill` task that copies their recent posts
   into your feed.
4. `link_preview` fetches the URL through the SSRF guard and stores the title /
   description / image URL.

## Security notes (mapping to the requirements)

* **SQL injection** — all DB access goes through the SQLAlchemy ORM, which uses
  bound parameters; no string-built SQL.
* **Password storage** — bcrypt with a per-password salt (`app/security.py`).
* **Input validation** — Pydantic schemas + explicit username/content checks.
* **XSS / output encoding** — Jinja2 autoescaping; a strict CSP
  (`default-src 'self'`, no inline scripts); remote preview images are shown as
  text, not loaded.
* **CSRF** — per-session synchroniser token, required on every state-changing
  request (form field or `X-CSRF-Token` header), compared in constant time.
* **Access control / IDOR** — post deletion and all per-user actions are checked
  against the authenticated user; non-owners get `404`.
* **Session cookies** — opaque server-side session token in a cookie that is
  `HttpOnly`, `SameSite`, and `Secure` (set `COOKIE_SECURE=true` behind HTTPS).
  Session token + CSRF token are rotated on login (fixation prevention).
* **Security headers** — CSP, `X-Content-Type-Options`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `Permissions-Policy`, COOP/CORP, and HSTS when on HTTPS.
* **Error handling** — generic error responses; stack traces are logged
  server-side only and never returned to clients (unless `DEBUG=true`).
* **Secrets** — read from environment variables; nothing sensitive is hardcoded.

### SSRF protection (`app/ssrf.py`)

For every outbound link-preview request:

* **Scheme allow-list:** only `http` / `https`.
* **Host resolution + deny-list:** every resolved A/AAAA address is rejected if
  it is private, loopback, link-local, reserved, multicast or unspecified. This
  blocks `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`,
  `169.254.0.0/16` (including the `169.254.169.254` cloud-metadata endpoint),
  `::1`, and `fc00::/7`. IPv4-mapped IPv6 addresses are normalised first.
* **DNS-rebinding protection:** the validated IP is pinned for the actual TCP
  connection (the Host header / SNI keep the original hostname), so the name
  cannot re-resolve to an internal address between check and connect.
* **No automatic redirects:** each redirect hop is re-validated before connect.
* **Limits:** connect/read timeouts and a hard maximum response size.

## Project layout

```
app/
  main.py        # app, middleware, security headers, error handlers
  config.py      # env-driven settings
  database.py    # engine/session (SQLite WAL + FK pragmas)
  models.py      # ORM models
  schemas.py     # Pydantic validation
  security.py    # bcrypt hashing, tokens, CSRF compare
  ssrf.py        # SSRF-hardened link fetcher
  tasks.py       # DB-backed queue + worker loop + handlers
  services.py    # business logic shared by API and UI
  deps.py        # auth/session/CSRF dependencies
  routes/
    api.py       # REST API
    web.py       # HTML UI
  templates/     # Jinja2 templates (autoescaped)
  static/        # CSS
run.py           # web server entrypoint (port 5091)
worker.py        # standalone worker entrypoint
```

## Notes / limitations

* SQLite is used for zero-setup local running. Point `DATABASE_URL` at
  PostgreSQL for multi-process production use; the ORM code is unchanged.
* The in-process worker is a single thread — fine for local use. For production,
  run one or more `worker.py` processes with `WORKER_ENABLED=false`.
