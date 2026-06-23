# Secure File Storage

A small Node.js / Express application where users register, upload files into their
own personal storage, and create **read-only share links** that grant access to a
single file. Users can list and revoke their share links at any time. Metadata is
stored in SQLite; the file bytes live on disk under server-generated random names.

## Features

- User registration and login (passwords hashed with **bcrypt**).
- Per-user file storage with upload, download, and delete.
- Revocable, per-file public share links (`/s/<token>`), read-only.
- IDOR-safe: every action is scoped to the authenticated owner.

## Requirements

- Node.js 18+ and npm.
- A C/C++ toolchain is needed to build the native `better-sqlite3` module
  (on Windows, install the "Desktop development with C++" workload, or run
  `npm install --global windows-build-tools` on older setups).

## Run locally (port 5082)

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file
cp .env.example .env
#    Generate a strong session secret and paste it into SESSION_SECRET:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 3. Start the server
npm start
```

Then open <http://localhost:5082>, register an account, and start uploading.

> The port is configurable via `PORT` in `.env` (defaults to **5082**).
> Data is created on first run: SQLite DB under `./data/`, uploaded files under
> `./uploads/`. Both directories are git-ignored.

## Configuration (`.env`)

| Variable           | Purpose                                                        | Default     |
| ------------------ | ------------------------------------------------------------- | ----------- |
| `SESSION_SECRET`   | Signs the session cookie. **Required** for stable sessions.   | (ephemeral) |
| `PORT`             | Listen port.                                                  | `5082`      |
| `COOKIE_SECURE`    | Set `true` only when served over HTTPS (Secure cookie flag).  | `false`     |
| `MAX_UPLOAD_BYTES` | Maximum accepted upload size in bytes.                        | `10485760`  |

Secrets are read only from the environment; nothing is hardcoded.

## Allowed upload types

Uploads are accepted only when their **inspected content** (magic bytes) matches an
allow-list — the client-supplied filename and `Content-Type` are never trusted:

`PNG, JPG, GIF, WEBP, PDF` — anything else is rejected and deleted.

## Security overview (OWASP Top 10)

- **Injection** — all SQL uses parameterised `better-sqlite3` prepared statements.
- **Authentication** — bcrypt (cost 12) salted hashing; session regenerated on
  login/registration to prevent fixation; generic login errors and constant-work
  comparison resist user enumeration; auth endpoints are rate-limited.
- **Access control / IDOR** — every file and share query is filtered by the
  owner's `user_id`; share tokens grant read access to exactly one file.
- **XSS** — output is rendered through EJS auto-escaping (`<%= %>`); a strict
  Content-Security-Policy (no inline scripts) is applied via Helmet.
- **CSRF** — synchronizer-token pattern: a per-session token is embedded in every
  form and verified (constant-time) on all state-changing POST requests.
- **Secure cookies** — session cookie is `HttpOnly`, `SameSite=Lax`, and `Secure`
  when `COOKIE_SECURE=true`.
- **Security headers** — Helmet sets CSP, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy`, frame-ancestors `none`, etc.
- **Error handling** — a central handler returns generic messages; stack traces
  and internals are never sent to clients.
- **File-upload hardening** — content-sniffed allow-list, enforced max size,
  random server-generated storage names, uploads stored outside any executable/
  served path, served only as `attachment` with `nosniff`, and path-traversal
  guards that confine all reads/writes to the upload directory.
- **Secrets** — read exclusively from environment variables.

## Project layout

```
src/
  server.js            # entrypoint
  app.js               # express wiring, security headers, sessions, routes
  config.js            # env-driven configuration
  db.js                # SQLite schema + connection
  middleware/security.js  # auth guard, CSRF, current-user
  lib/filetype.js      # magic-byte content detection (allow-list)
  lib/validate.js      # input validation helpers
  routes/auth.js       # register / login / logout
  routes/files.js      # upload / download / delete
  routes/shares.js     # create / revoke / public share download
  views/               # EJS templates (auto-escaped)
  public/style.css     # static assets
```
