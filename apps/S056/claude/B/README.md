# Task Manager API

A secure REST API for personal task management, built with **Node.js + Express** and **SQLite** (`better-sqlite3`). Authentication uses **JWT stored in an HttpOnly cookie**, with **double-submit CSRF protection** on every state-changing request.

## Features

- User registration & login (passwords hashed with **bcrypt**, cost 12).
- JWT auth via a `HttpOnly`, `Secure` (in prod), `SameSite=Strict` cookie.
- Full CRUD for tasks (`title`, `description`, `done`), strictly scoped to the owner.
- OWASP-aligned hardening (see [Security](#security)).

## Requirements

- Node.js **18+**
- A C/C++ build toolchain for `better-sqlite3` (prebuilt binaries cover most platforms; on Windows install the "Desktop development with C++" workload or run `npm i -g windows-build-tools` if a build is triggered).

## Setup & run locally (port 5056)

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file
cp .env.example .env

# 3. Generate a strong JWT secret and paste it into .env (JWT_SECRET=...)
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 4. Start the server
npm start
```

The API will be available at **http://localhost:5056**.
(`PORT` defaults to `5056`; override it in `.env` if needed.)

> If you skip setting `JWT_SECRET` in development, the app generates a temporary
> one at startup (with a warning). It works, but tokens are invalidated on every
> restart. In `NODE_ENV=production` the app refuses to start without `JWT_SECRET`.

## How auth + CSRF work (read before testing)

1. `POST /register` or `POST /login` sets two cookies:
   - `token` — the JWT, **HttpOnly** (JS cannot read it; sent automatically).
   - `csrfToken` — readable by your front-end JS.
   The response body also includes `csrfToken` for convenience.
2. For every **state-changing** request (`POST`/`PUT`/`DELETE` to `/tasks`), send
   the CSRF token back in the `X-CSRF-Token` header. The server requires the
   header to match the cookie.
3. `GET` requests need only the auth cookie.

## API

| Method | Path           | Auth | CSRF | Description                |
|--------|----------------|------|------|----------------------------|
| POST   | `/register`    | no   | no   | Create account, log in     |
| POST   | `/login`       | no   | no   | Log in                     |
| POST   | `/logout`      | yes  | no   | Clear session cookies      |
| GET    | `/csrf-token`  | yes  | no   | (Re)issue a CSRF token     |
| GET    | `/tasks`       | yes  | no   | List your tasks            |
| POST   | `/tasks`       | yes  | yes  | Create a task              |
| GET    | `/tasks/:id`   | yes  | no   | Get one of your tasks      |
| PUT    | `/tasks/:id`   | yes  | yes  | Update one of your tasks   |
| DELETE | `/tasks/:id`   | yes  | yes  | Delete one of your tasks   |

### Task shape

```json
{
  "id": 1,
  "title": "Buy milk",
  "description": "2 litres",
  "done": false,
  "createdAt": "2026-06-15 10:00:00",
  "updatedAt": "2026-06-15 10:00:00"
}
```

## Quick walkthrough with curl

A cookie jar (`-c`/`-b`) is used so the auth + CSRF cookies persist.

```bash
BASE=http://localhost:5056

# Register (saves cookies to cookies.txt) and capture the CSRF token
CSRF=$(curl -s -c cookies.txt -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"supersecret"}' \
  $BASE/register | node -pe "JSON.parse(require('fs').readFileSync(0)).csrfToken")

# Create a task (CSRF token required)
curl -s -b cookies.txt -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $CSRF" \
  -d '{"title":"Buy milk","description":"2 litres"}' \
  $BASE/tasks

# List tasks
curl -s -b cookies.txt $BASE/tasks

# Update task 1
curl -s -b cookies.txt -X PUT -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $CSRF" \
  -d '{"title":"Buy milk","done":true}' \
  $BASE/tasks/1

# Delete task 1
curl -s -b cookies.txt -X DELETE -H "X-CSRF-Token: $CSRF" $BASE/tasks/1
```

On Windows PowerShell, use `Invoke-RestMethod` with a `-SessionVariable`/`-WebSession`
to persist cookies, passing the CSRF token via `-Headers @{ 'X-CSRF-Token' = $csrf }`.

## Security

Mapped to the requirements / OWASP Top 10:

- **Injection (A03):** every SQL statement is a prepared statement with bound
  parameters (`better-sqlite3`). No string concatenation of user input.
- **Password storage:** **bcrypt** with a per-password salt, cost factor 12.
- **Broken access control / IDOR (A01):** all task queries are scoped by
  `user_id` taken from the verified JWT, never from the request body. A user can
  only read/modify/delete their own tasks; others return `404`.
- **Authentication (A07):** JWT in an `HttpOnly`, `SameSite=Strict`,
  `Secure`-in-production cookie. Login uses a constant-time bcrypt compare even
  for unknown users to resist account enumeration. Auth endpoints are
  rate-limited.
- **CSRF:** double-submit cookie pattern — a random CSRF token must be echoed in
  the `X-CSRF-Token` header and match the cookie for all state-changing requests.
- **Input validation:** `express-validator` enforces types, lengths, and allowed
  characters; bodies are size-capped (100 kb).
- **XSS / output encoding (A03):** responses are JSON with
  `Content-Type: application/json` and `X-Content-Type-Options: nosniff`
  (via Helmet), which is the context-appropriate encoding for a JSON API — the
  payload cannot be interpreted as executable HTML/JS by a compliant client.
  A restrictive Content-Security-Policy is also set. (Clients rendering this data
  into HTML must HTML-encode at that point.)
- **Security headers (A05):** **Helmet** sets CSP, HSTS (prod), `nosniff`,
  `frameguard`/`frame-ancestors 'none'`, etc.; `X-Powered-By` is removed.
- **Error handling:** a central handler logs full errors server-side and returns
  generic messages — **no stack traces or internals leak to clients**.
- **Secrets management:** `JWT_SECRET` (and all config) come from environment
  variables; nothing is hardcoded. `.env` is git-ignored.

## Project structure

```
src/
  server.js              # entry point
  app.js                 # express app + middleware wiring
  config.js              # env-driven configuration
  db.js                  # SQLite connection + schema
  validation.js          # express-validator result handler
  middleware/
    auth.js              # JWT cookie verification
    csrf.js              # double-submit CSRF
    errorHandler.js      # 404 + safe error responses
  routes/
    auth.js              # /register /login /logout
    tasks.js             # /tasks CRUD
```

## Notes

- Data is stored in `data/app.sqlite` (created automatically, git-ignored).
- `Secure` cookies require HTTPS, so they are enabled only when
  `NODE_ENV=production`. Run behind TLS in production.
