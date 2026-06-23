# PhotoShare

A small but production-minded photo-sharing web app built with **Node.js + Express**.
Users can register, upload photos, follow other users, like and comment on photos,
and see a feed of recent photos from the people they follow.

Data is stored in a local **SQLite** database; uploaded image files are stored on
disk under server-generated random names in a directory that is **not** web-served
as static/executable content.

## Features

- Username/password accounts (passwords hashed with bcrypt, 12 rounds)
- Upload JPEG / PNG / GIF / WebP images with optional captions
- Follow / unfollow users
- Like / unlike photos
- Comment on photos (author or photo owner can delete a comment)
- Personal feed of recent photos from followed users (and your own)
- Public profile pages with photo galleries and follower counts

## Requirements

- Node.js **18+** (uses only stable APIs; `npm` ships with Node)
- A C/C++ toolchain is **not** required — `better-sqlite3` ships prebuilt binaries
  for common platforms, and password hashing uses the pure-JS `bcryptjs`.

## Run it locally (port 5073)

```bash
# 1. Install dependencies
npm install

# 2. Create your local config from the template
cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env

# 3. Set a strong session secret in .env (optional in dev, required in prod)
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
#   ...paste the output as SESSION_SECRET in .env

# 4. Start the server
npm start
```

Then open <http://localhost:5073>.

The port is configurable via `PORT` in `.env` and defaults to **5073**.
The SQLite database and uploads directory are created automatically under `./var/`
on first run.

> **Dev vs production cookies:** the session cookie's `Secure` flag is enabled only
> when `NODE_ENV=production` (behind HTTPS). For local HTTP development it is off so
> the cookie is still sent; everything else (`HttpOnly`, `SameSite=Lax`) is always on.

## Project layout

```
src/
  server.js            # entry point
  app.js               # Express app wiring, security middleware, error handler
  config.js            # env-driven config (no hardcoded secrets)
  db.js                # SQLite connection + schema
  middleware/
    auth.js            # session user loading + auth gate
    csrf.js            # synchronizer-token CSRF protection
    upload.js          # multipart parsing + magic-byte content validation
    flash.js           # one-shot flash messages
  routes/
    auth.js            # register / login / logout
    feed.js            # home + feed
    photos.js          # upload / view / like / comment / delete
    users.js           # profiles + follow
    files.js           # hardened upload-file serving
views/                 # EJS templates (auto-escaped output)
public/css/style.css   # static assets (served under /static)
var/                   # created at runtime: SQLite db + uploaded files (git-ignored)
```

## Security measures (OWASP Top 10)

- **SQL injection (A03):** every query uses parameterised statements via
  `better-sqlite3` prepared statements — no string concatenation of user input.
- **Authentication (A07):** passwords hashed with bcrypt (cost 12) + per-hash salt;
  constant-time comparison; generic login errors; session regenerated on login to
  prevent fixation; login/register rate-limited.
- **Access control / IDOR (A01):** every state-changing action checks ownership
  (only a photo's owner can delete it; only a comment's author or the photo owner
  can delete a comment; follow/like act only as the logged-in user). Resource IDs
  are validated as integers.
- **XSS (A03):** all dynamic output is rendered through EJS `<%= %>` which
  HTML-escapes by default; a strict Content-Security-Policy (no inline scripts)
  provides defense in depth.
- **CSRF (A01):** synchronizer-token pattern — a per-session random token must be
  echoed in every POST (hidden `_csrf` field or `X-CSRF-Token` header), compared in
  constant time. `SameSite=Lax` cookies add a second layer.
- **Security headers (A05):** `helmet` sets CSP, `X-Content-Type-Options`,
  `Referrer-Policy`, frame-ancestors `none`, etc. `X-Powered-By` is disabled.
- **Secure session cookies:** `HttpOnly`, `SameSite=Lax`, and `Secure` in production.
- **Error handling:** a central handler logs full details server-side only and never
  returns stack traces or internal messages to clients.
- **Secrets:** read from environment variables; the app refuses to start in
  production without a real `SESSION_SECRET`.

### File-upload hardening

- **Type allow-list by content, not name:** uploaded bytes are inspected for the
  magic numbers of JPEG, PNG, GIF, and WebP. The client-supplied filename and
  `Content-Type` are ignored.
- **Size limit:** enforced by `multer` (`MAX_UPLOAD_BYTES`, default 5 MB), single
  file per request.
- **Random server-generated names:** files are saved as 32 random hex chars plus a
  validated extension. The original filename is never used or stored.
- **Non-executable, non-static storage:** uploads live in `./var/uploads` (outside
  the `public/` static root) and are streamed only through a dedicated handler that
  sets `Content-Type` explicitly with `nosniff`.
- **Path-traversal prevention:** the upload write path is verified to resolve inside
  the upload directory, and the serving route accepts only names matching a strict
  `^[a-f0-9]{32}\.(jpg|png|gif|webp)$` pattern (no slashes or `..` can pass).
```
