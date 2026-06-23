# DocMan — Secure Document Management

A Node.js / Express application for managing documents: organise files into
folders, share them with specific users or groups (view / edit rights), and keep
a full version history with the ability to restore any previous version.

Data is stored in **SQLite** (via `better-sqlite3`) and uploaded files are stored
as opaque blobs on disk under a directory that is **never served as code**.

---

## Requirements

- Node.js **18+** (uses native `better-sqlite3` and `bcrypt` — prebuilt binaries
  are downloaded automatically on install; a C/C++ build toolchain is only needed
  if a prebuilt binary is unavailable for your platform).

## Run it locally (port 5088)

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file and set a session secret
cp .env.example .env
#    Generate a strong secret and paste it into SESSION_SECRET in .env:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 3. Start the server
npm start
```

Then open <http://localhost:5088>.

> If you skip step 2 in development, the app still starts using a temporary,
> randomly generated session secret (you'll see a warning, and sessions won't
> survive a restart). In production (`NODE_ENV=production`) a `SESSION_SECRET`
> is **required** and the app refuses to start without one.

The SQLite database and uploaded files are created automatically under `./data/`
(`data/docman.db` and `data/uploads/`). This directory is git-ignored.

## Quick tour

1. **Register** an account, then log in.
2. Create a **folder** and **upload** a document into it (PDF, PNG, JPEG, GIF or
   plain text).
3. Open the document to see its **version history**. Upload a new version, or
   **restore** an older one (restoring creates a new current version, preserving
   history).
4. **Share** the document with another user by username, or with a **group** you
   own, granting **view** or **edit** rights. Shared documents appear under
   "Shared with me" on the recipient's dashboard.
5. Create **groups** under the *Groups* tab and add members to share with several
   people at once.

---

## Configuration (environment variables)

| Variable           | Default        | Purpose                                                        |
| ------------------ | -------------- | -------------------------------------------------------------- |
| `PORT`             | `5088`         | Port to listen on.                                             |
| `SESSION_SECRET`   | *(none)*       | Secret signing key for session cookies. Required in prod.      |
| `COOKIE_SECURE`    | `false`        | Set `true` when serving over HTTPS (adds the `Secure` flag).   |
| `NODE_ENV`         | `development`  | `production` hides error details and hardens cookie defaults.  |
| `BCRYPT_ROUNDS`    | `12`           | bcrypt cost factor for password hashing.                       |
| `MAX_UPLOAD_BYTES` | `10485760`     | Maximum upload size in bytes (10 MiB).                         |

No secrets are hardcoded — they are all read from the environment.

---

## Security measures (mapped to OWASP Top 10)

- **SQL injection (A03)** — every query uses parameterised, prepared statements
  (`better-sqlite3`). No string concatenation of user input into SQL.
- **Broken access control / IDOR (A01)** — all authorisation flows through a
  single chokepoint (`src/access.js`) keyed on the authenticated **session**
  user id, never a client-supplied id. Folders/groups are owner-checked;
  documents resolve an effective permission (owner / edit / view) from direct
  and group shares. Object ids are validated as positive integers.
- **Authentication (A07)** — passwords hashed with **bcrypt** (per-password salt,
  configurable cost). Login uses a constant-time comparison and uniform timing
  whether or not the account exists, with generic error messages. Sessions are
  regenerated on login/registration to prevent **session fixation**. Login and
  registration are **rate-limited**.
- **Session cookies** — `HttpOnly`, `SameSite=Lax`, and `Secure` (when
  `COOKIE_SECURE=true` / production). Custom cookie name, rolling expiry.
- **CSRF** — synchronizer-token pattern: a per-session token is required on every
  state-changing request (form field `_csrf` or `x-csrf-token` header) and
  verified in constant time. `SameSite` cookies add defence in depth.
- **XSS (A03)** — output is context-encoded by EJS auto-escaping (`<%= %>`);
  no `<%- %>` is used for user data. Input is validated/normalised server-side.
  A strict **Content-Security-Policy** (no inline scripts) is set via Helmet.
- **Security headers (A05)** — Helmet sets CSP, `X-Content-Type-Options:nosniff`,
  `Referrer-Policy`, frame-ancestors `none`, and related headers.
- **Error handling** — a central handler logs full details server-side and never
  returns stack traces or internal details to clients.
- **Secrets management** — read exclusively from environment variables.

### File-upload hardening

- **Content-based type validation** — the accepted type is decided by inspecting
  the file's **magic bytes** (`src/upload.js`), not the client filename or
  `Content-Type`. Allow-list: PDF, PNG, JPEG, GIF, and validated plain text.
- **Size limit** — enforced by Multer (`MAX_UPLOAD_BYTES`, default 10 MiB).
- **Random storage names** — every stored file gets a server-generated random
  name (`<32 hex>.bin`); the user-supplied filename is stored only as metadata
  for display/download and is never used as a path.
- **No path traversal** — stored paths are validated against a strict pattern and
  re-resolved to guarantee they remain inside the upload directory.
- **Not executable / no inline rendering** — uploads live outside any static
  route. Downloads are sent as `attachment` with `nosniff` and a locked-down CSP,
  so content is never executed or rendered inline.

---

## Project layout

```
src/
  server.js            App wiring: helmet, sessions, CSRF, routes, error handler
  db.js                SQLite connection + schema
  security.js          CSRF, input validation, flash messages
  access.js            Authorisation chokepoint (permission resolution)
  upload.js            Multer + magic-byte validation + safe storage
  middleware.js        Session user loading + auth gate
  routes/              auth, folders, documents, groups
  views/               EJS templates (auto-escaped)
public/style.css       Stylesheet (no inline JS/CSS, CSP-friendly)
```
